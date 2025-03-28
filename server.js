const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp'); // Import sharp

const app = express();
const port = 3000;

// --- Path Configuration ---
// Assumes server.js is in 'image-share-app' and 'outputs' is one level up
const baseDir = path.join(__dirname, '..'); // Navigate up one level from server.js location
const outputsDir = path.join(baseDir, 'outputs');
const thumbnailBaseDir = path.join(outputsDir, '.thumbnails'); // Store thumbnails inside outputs/.thumbnails
const publicDir = path.join(__dirname, 'public');
const viewsDir = path.join(__dirname, 'views');

// --- Thumbnail Configuration ---
const THUMBNAIL_WIDTH = 300; // Width for generated thumbnails (adjust as needed)

// --- Middleware ---
app.use(express.static(publicDir));

// Serve ORIGINAL images from 'outputs' (excluding .thumbnails) via /images
app.use('/images', express.static(outputsDir, {
    // Optional: Prevent serving the .thumbnails directory directly if needed,
    // although access control is better handled by not linking to it directly.
    // dotfiles: 'ignore' // Might hide .thumbnails if accessed directly via /images/.thumbnails
}));

// Serve GENERATED thumbnails from 'outputs/.thumbnails' via /thumbnails
// Ensure this directory exists before starting (or create on the fly)
app.use('/thumbnails', express.static(thumbnailBaseDir));

// --- Routes ---
app.get('/', (req, res) => {
    res.sendFile(path.join(viewsDir, 'index.html'));
});

app.get('/api/images', async (req, res) => {
    try {
        console.log(`Scanning image directory: ${outputsDir}`);
        // Ensure thumbnail base directory exists
        await fs.mkdir(thumbnailBaseDir, { recursive: true });
        console.log(`Thumbnail directory ensured: ${thumbnailBaseDir}`);

        const imageDataList = await scanImageDirectory(outputsDir, '');
        console.log(`Found and processed ${imageDataList.length} images.`);
        res.json(imageDataList);
    } catch (error) {
        console.error('Error scanning image directory or generating thumbnails:', error);
        res.status(500).json({ error: 'Failed to load images from server.' });
    }
});

// --- Helper Function to Scan Directory and Manage Thumbnails ---
async function scanImageDirectory(baseScanDir, currentRelativeDir) {
    const fullCurrentDir = path.join(baseScanDir, currentRelativeDir);
    let images = [];
    const entries = await fs.readdir(fullCurrentDir, { withFileTypes: true });

    for (const entry of entries) {
        const entryName = entry.name;
        // Skip the thumbnail directory itself!
        if (entry.isDirectory() && entryName === '.thumbnails') {
            continue;
        }

        const entryRelativePath = path.join(currentRelativeDir, entryName).replace(/\\/g, '/');
        const fullEntryPath = path.join(fullCurrentDir, entryName);

        if (entry.isDirectory()) {
            const subImages = await scanImageDirectory(baseScanDir, entryRelativePath);
            images = images.concat(subImages);
        } else if (entry.isFile() && /\.(jpe?g|png|gif|webp|bmp|tiff)$/i.test(entryName)) {

            const thumbnailRelativePath = entryRelativePath; // Use the same relative path for the thumbnail
            const thumbnailPath = path.join(thumbnailBaseDir, thumbnailRelativePath);
            const thumbnailDir = path.dirname(thumbnailPath);

            try {
                // Check if thumbnail exists
                await fs.access(thumbnailPath, fs.constants.F_OK);
                 // console.log(`Thumbnail exists for ${entryRelativePath}`);
            } catch (err) {
                // Thumbnail does NOT exist, generate it
                console.log(`Generating thumbnail for ${entryRelativePath}...`);
                try {
                    await fs.mkdir(thumbnailDir, { recursive: true }); // Ensure directory exists
                    await sharp(fullEntryPath)
                        .resize({ width: THUMBNAIL_WIDTH }) // Resize to specified width, auto height
                        .toFile(thumbnailPath);
                    console.log(` > Thumbnail created: ${thumbnailPath}`);
                } catch (thumbError) {
                    console.error(` X Failed to generate thumbnail for ${entryRelativePath}:`, thumbError);
                    // Continue processing other images even if one thumbnail fails
                }
            }

            // --- Metadata Reading (moved after thumbnail check/gen) ---
            let title = entryName.replace(/\.[^/.]+$/, "");
            let author = 'Unknown';
            let collection = currentRelativeDir || 'root';

            try {
                const metadata = await exifr.parse(fullEntryPath, {
                        tiff: true, ifd0: true, exif: true, xmp: true, iptc: true, ihdr: true, userComment: true
                    }).catch(metaError => {
                        console.warn(`Could not read metadata for ${entryRelativePath}: ${metaError.message}`);
                        return null;
                    });

                if (metadata) {
                    let promptText = null;
                    if (typeof metadata.parameters === 'string' && metadata.parameters.trim()) promptText = metadata.parameters.trim();
                    else if (typeof metadata.UserComment === 'string' && metadata.UserComment.trim()) promptText = metadata.UserComment.trim();
                    else if (typeof metadata.ImageDescription === 'string' && metadata.ImageDescription.trim()) promptText = metadata.ImageDescription.trim();
                    else if (typeof metadata.title === 'string' && metadata.title.trim()) promptText = metadata.title.trim();
                    if (promptText) title = promptText.split('\n')[0];

                    if (typeof metadata.Artist === 'string' && metadata.Artist.trim()) author = metadata.Artist.trim();
                    else if (typeof metadata.author === 'string' && metadata.author.trim()) author = metadata.author.trim();
                    else if (typeof metadata.creator === 'string' && metadata.creator.trim()) author = metadata.creator.trim();
                }
            } catch (metaReadError) {
                 console.error(`Error reading metadata for ${entryRelativePath}:`, metaReadError);
            }
            // --- End Metadata Reading ---


            images.push({
                // Use the /images path for the full original image
                url: `/images/${entryRelativePath}`,
                // Use the /thumbnails path for the thumbnail
                thumbnailUrl: `/thumbnails/${thumbnailRelativePath}`,
                title: title,
                author: author,
                fileName: entryName,
                collection: collection,
                relativePath: entryRelativePath
            });
        }
    }
    return images;
}

// --- Start Server ---
app.listen(port, () => {
    console.log(`ImageShare server running at http://localhost:${port}`);
    console.log(`Watching image directory: ${outputsDir}`);
    console.log(`Thumbnail directory: ${thumbnailBaseDir}`);
    console.log(`Serving static assets from: ${publicDir}`);
});