const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs'); // Use sync version only for specific checks if needed
const sharp = require('sharp');
const exifr = require('exifr');
const multer = require('multer'); // For file uploads
const archiver = require('archiver'); // For zipping collections

const app = express();
const PORT = 3000;

// --- Configuration ---
const THUMBNAIL_WIDTH = 300;
const VALID_IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|bmp|tiff)$/i;
const FORBIDDEN_NAMES = /^\.|\.\.$/; // Prevent accessing hidden files/folders or parent dirs

// --- Path Definitions ---
const appBaseDir = __dirname;
const projectRootDir = path.join(appBaseDir, '..');
const outputsDir = path.join(projectRootDir, 'outputs');
const thumbnailBaseDir = path.join(outputsDir, '.thumbnails');
const publicDir = path.join(appBaseDir, 'public');
const viewsDir = path.join(appBaseDir, 'views');

// --- Ensure Base Directories Exist ---
// Use synchronous checks on startup, async for operations
if (!fsSync.existsSync(outputsDir)) {
    console.log(`Creating base image directory: ${outputsDir}`);
    fsSync.mkdirSync(outputsDir, { recursive: true });
}
if (!fsSync.existsSync(thumbnailBaseDir)) {
    console.log(`Creating base thumbnail directory: ${thumbnailBaseDir}`);
    fsSync.mkdirSync(thumbnailBaseDir, { recursive: true });
}

// --- Helper: Sanitize Filenames/Paths ---
function sanitizeInput(input) {
    if (!input) return '';
    // Remove potentially harmful characters, replace spaces
    return input.replace(/[\/\?\<\>\\:\*\|"'\.\s\(\)]+/g, '_').replace(/^_+|_+$/g, ''); // Basic sanitize
}

// --- Multer Configuration for File Uploads ---
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        let collection = sanitizeInput(req.body.collection) || 'root'; // Get collection from form data
        let targetDir;

        if (collection === '_new_') {
            // Create a new collection
            const newCollectionName = sanitizeInput(req.body.newCollectionName);
            if (!newCollectionName || FORBIDDEN_NAMES.test(newCollectionName)) {
                return cb(new Error('Invalid new collection name provided.'), null);
            }
            targetDir = path.join(outputsDir, newCollectionName);
            collection = newCollectionName; // Use the new name going forward
        } else if (collection === 'root') {
            targetDir = outputsDir; // Upload to base outputs directory
        } else {
             if (FORBIDDEN_NAMES.test(collection)) {
                 return cb(new Error('Invalid collection name.'), null);
             }
            targetDir = path.join(outputsDir, collection); // Upload to existing collection
        }

        try {
            // Ensure the target directory exists
            await fs.mkdir(targetDir, { recursive: true });
            // Store the resolved collection name for the route handler
            req.resolvedCollection = collection === 'root' ? '' : collection;
            req.targetFilePath = targetDir; // Store for thumbnail generation later
            cb(null, targetDir);
        } catch (err) {
            console.error("Error ensuring upload directory:", err);
            cb(new Error('Could not create or access upload directory.'), null);
        }
    },
    filename: (req, file, cb) => {
        // Sanitize filename, keep extension
        const originalName = file.originalname;
        const extension = path.extname(originalName);
        const baseName = path.basename(originalName, extension);
        const sanitizedBaseName = sanitizeInput(baseName) || `image_${Date.now()}`; // Fallback name
        const finalFilename = `${sanitizedBaseName}${extension}`;
        req.uploadedFilename = finalFilename; // Store for thumbnail generation
        cb(null, finalFilename);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        // Accept only valid image types
        if (VALID_IMAGE_EXTENSIONS.test(path.extname(file.originalname).toLowerCase())) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only images are allowed.'), false);
        }
    },
    limits: { fileSize: 20 * 1024 * 1024 } // Example: 20MB limit
}).single('imageFile'); // Matches the name attribute in the form

// --- Middleware ---
app.use(express.static(publicDir));
app.use('/images', express.static(outputsDir));
app.use('/thumbnails', express.static(thumbnailBaseDir));
// Middleware to parse URL-encoded bodies (like from forms, though we use FormData)
app.use(express.urlencoded({ extended: true }));
// Middleware to parse JSON bodies (useful for potential future API interactions)
app.use(express.json());


// --- Routes ---
app.get('/', (req, res) => {
    res.sendFile(path.join(viewsDir, 'index.html'));
});

// GET list of images
app.get('/api/images', async (req, res) => {
    try {
        const imageDataList = await scanImageDirectoryRecursive(outputsDir, '');
        res.json(imageDataList);
    } catch (error) {
        console.error('Error getting image list:', error);
        res.status(500).json({ error: 'Failed to retrieve image list.' });
    }
});

// GET list of collections (subdirectories in outputs)
app.get('/api/collections', async (req, res) => {
    try {
        const collections = await getCollectionList(outputsDir);
        res.json(collections);
    } catch (error) {
        console.error('Error getting collection list:', error);
        res.status(500).json({ error: 'Failed to retrieve collection list.' });
    }
});


// POST Upload a new image
app.post('/api/upload', (req, res) => {
    upload(req, res, async (err) => { // Pass req, res to multer middleware result
        if (err) {
            console.error("Upload error:", err.message);
            // Handle specific multer errors if needed
            if (err instanceof multer.MulterError) {
                return res.status(400).json({ error: `Upload error: ${err.code}` });
            }
            return res.status(400).json({ error: err.message || 'File upload failed.' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No image file was uploaded.' });
        }

        console.log('File uploaded successfully:', req.file.path);
        // Additional info needed for thumbnail generation
        const uploadedFileFullPath = req.file.path;
        const filename = req.uploadedFilename; // Filename set by multer storage
        const collectionPath = req.resolvedCollection; // Collection path relative to outputsDir
        const relativePath = path.join(collectionPath, filename).replace(/\\/g, '/');

        // Trigger thumbnail generation AFTER successful upload
        try {
            await generateThumbnail(relativePath, uploadedFileFullPath);
            console.log(`Thumbnail generated for uploaded file: ${relativePath}`);

            // Respond with success (maybe include details of the uploaded file)
            res.json({
                message: 'File uploaded and processed successfully!',
                filename: filename,
                collection: collectionPath || 'root',
                relativePath: relativePath
            });
        } catch (thumbErr) {
            console.error("Error generating thumbnail for uploaded file:", thumbErr);
            // Decide how critical thumbnail failure is. Maybe still return success but log error.
            res.status(500).json({
                 error: 'File uploaded, but thumbnail generation failed.',
                 filename: filename,
                 collection: collectionPath || 'root'
            });
        }
    });
});


// GET Download an entire collection as a ZIP
app.get('/api/download/collection/:collectionName', async (req, res) => {
    const collectionNameParam = req.params.collectionName;

    // Validate and sanitize collection name
    if (!collectionNameParam || FORBIDDEN_NAMES.test(collectionNameParam)) {
        return res.status(400).send('Invalid collection name.');
    }
    // Handle 'root' specifically if you want to allow downloading the base dir
    // For safety, let's disallow downloading 'root' directly this way for now.
    if (collectionNameParam === 'root') {
         return res.status(400).send('Downloading the root directory is not supported via this endpoint.');
    }

    const collectionPath = path.join(outputsDir, collectionNameParam);
    const zipFileName = `${collectionNameParam}.zip`;

    try {
        // Check if the directory exists and is actually a directory
        const stats = await fs.stat(collectionPath);
        if (!stats.isDirectory()) {
            return res.status(404).send('Collection not found or is not a directory.');
        }

        res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${zipFileName}"`
        });

        const archive = archiver('zip', { zlib: { level: 9 } }); // Set compression level

        // Handle warnings and errors during archiving
        archive.on('warning', (err) => {
            if (err.code === 'ENOENT') {
                console.warn('Archiver warning:', err); // File not found etc.
            } else {
                throw err; // Rethrow unexpected warnings
            }
        });
        archive.on('error', (err) => {
            console.error('Archiving error:', err);
            // Try to end the response gracefully if possible
            if (!res.headersSent) {
                res.status(500).send('Error creating zip file.');
            } else {
                 res.end(); // End the stream if headers already sent
            }
        });

        // Pipe archive data to the response
        archive.pipe(res);

        // Add the directory contents to the archive
        // The second argument is the path prefix inside the zip file (false means no prefix)
        archive.directory(collectionPath, false);

        // Finalize the archive (triggers writing)
        await archive.finalize();
        console.log(`Successfully streamed ZIP for collection: ${collectionNameParam}`);

    } catch (err) {
        if (err.code === 'ENOENT') {
            res.status(404).send('Collection not found.');
        } else {
            console.error(`Error preparing collection download (${collectionNameParam}):`, err);
            if (!res.headersSent) {
                 res.status(500).send('Error creating zip file.');
            } else {
                 res.end();
            }
        }
    }
});

// --- Core Logic Functions ---

async function getCollectionList(baseDir) {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const collections = entries
        .filter(entry => entry.isDirectory() && entry.name !== '.thumbnails' && !FORBIDDEN_NAMES.test(entry.name))
        .map(entry => entry.name);
    return collections.sort(); // Sort alphabetically
}

async function scanImageDirectoryRecursive(baseScanDir, currentRelativeDir) {
    const fullCurrentDir = path.join(baseScanDir, currentRelativeDir);
    let images = [];
    try {
        const entries = await fs.readdir(fullCurrentDir, { withFileTypes: true });
        for (const entry of entries) {
            const entryName = entry.name;
            if ((entry.isDirectory() && (entryName === '.thumbnails' || FORBIDDEN_NAMES.test(entryName))) || FORBIDDEN_NAMES.test(entryName)) {
                continue; // Skip thumbnails dir and hidden/forbidden files/dirs
            }
            const entryRelativePath = path.join(currentRelativeDir, entryName).replace(/\\/g, '/');
            const fullEntryPath = path.join(fullCurrentDir, entryName);

            if (entry.isDirectory()) {
                const subImages = await scanImageDirectoryRecursive(baseScanDir, entryRelativePath);
                images = images.concat(subImages);
            } else if (entry.isFile() && VALID_IMAGE_EXTENSIONS.test(entryName)) {
                try {
                    const imageData = await processImageFile(entryRelativePath, fullEntryPath);
                    if (imageData) images.push(imageData);
                } catch (processError) {
                    console.error(`Error processing image file ${entryRelativePath}:`, processError);
                }
            }
        }
    } catch (readDirError) {
        console.error(`Error reading directory ${fullCurrentDir}:`, readDirError);
    }
    return images;
}

async function processImageFile(relativePath, fullPath) {
    try {
        await generateThumbnail(relativePath, fullPath); // Ensure thumbnail exists
    } catch (thumbErr) {
        console.error(`Thumbnail processing failed for ${relativePath}, skipping metadata/inclusion. Error:`, thumbErr);
        return null; // Don't include image if thumbnail fails fundamentally
    }

    // --- Metadata Extraction (as before) ---
    let title = path.basename(relativePath, path.extname(relativePath));
    let author = 'Unknown';
    let collection = path.dirname(relativePath).split('/')[0] || 'root';
    if (collection === '.') collection = 'root';

    try {
        const metadata = await exifr.parse(fullPath, { /* options */ }).catch(metaError => {
            console.warn(`Metadata read warning for ${relativePath}: ${metaError.message}`);
            return null;
        });
        if (metadata) {
             let promptText = null;
            if (typeof metadata.parameters === 'string' && metadata.parameters.trim()) promptText = metadata.parameters.trim();
            else if (typeof metadata.UserComment === 'string' && metadata.UserComment.trim()) promptText = metadata.UserComment.trim();
            else if (typeof metadata.ImageDescription === 'string' && metadata.ImageDescription.trim()) promptText = metadata.ImageDescription.trim();
            else if (typeof metadata.title === 'string' && metadata.title.trim()) promptText = metadata.title.trim();
            if (promptText) title = promptText.split('\n')[0].trim();

            if (typeof metadata.Artist === 'string' && metadata.Artist.trim()) author = metadata.Artist.trim();
            else if (typeof metadata.author === 'string' && metadata.author.trim()) author = metadata.author.trim();
            else if (typeof metadata.creator === 'string' && metadata.creator.trim()) author = metadata.creator.trim();
        }
    } catch (metaReadError) {
        console.error(`Unexpected metadata processing error for ${relativePath}:`, metaReadError);
    }

    return {
        url: `/images/${relativePath}`,
        thumbnailUrl: `/thumbnails/${relativePath}`, // Use same relative path structure
        title: title,
        author: author,
        fileName: path.basename(relativePath),
        collection: collection,
        relativePath: relativePath
    };
}

async function generateThumbnail(relativePath, fullImagePath) {
    const thumbnailPath = path.join(thumbnailBaseDir, relativePath);
    const thumbnailDir = path.dirname(thumbnailPath);

    try {
        await fs.access(thumbnailPath, fs.constants.F_OK);
        // Optional: Add check here to see if thumbnail is older than original image
        // const imgStat = await fs.stat(fullImagePath);
        // const thumbStat = await fs.stat(thumbnailPath);
        // if (thumbStat.mtime >= imgStat.mtime) return; // Thumbnail is up-to-date
    } catch (err) {
        // Doesn't exist (or failed stat check), needs generation
        console.log(`Generating thumbnail for ${relativePath}...`);
        await fs.mkdir(thumbnailDir, { recursive: true });
        await sharp(fullImagePath)
            .resize({ width: THUMBNAIL_WIDTH })
            .toFile(thumbnailPath);
         console.log(` > Thumbnail created: ${thumbnailPath}`);
    }
     // Throw error upwards if sharp fails within this try-catch
}

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`🚀 Image Viewer Pro server running at http://localhost:${PORT}`);
    console.log(`   Watching images in: ${outputsDir}`);
});