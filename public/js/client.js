document.addEventListener('DOMContentLoaded', function() {

    // --- DOM Element References ---
    const galleryGrid = document.querySelector('.gallery-grid');
    const searchInput = document.getElementById('search-input');
    const categoryTagsContainer = document.querySelector('.category-tags');
    const createModal = document.getElementById('create-modal');
    const closeModalBtn = document.getElementById('close-modal');
    const createBtnHeader = document.getElementById('create-btn');
    const createBtnNav = document.getElementById('create-nav-btn');
    const refreshBtnNav = document.getElementById('refresh-gallery-nav');
    const refreshBtnHeader = document.getElementById('refresh-gallery-header');
    const galleryNav = document.getElementById('gallery-nav');
    // Upload Modal Elements
    const uploadArea = document.getElementById('upload-area');
    const imageFileInput = document.getElementById('image-file-input');
    const uploadPreview = uploadArea?.querySelector('.uploaded-preview');
    const uploadIcon = uploadArea?.querySelector('i.fa-cloud-upload-alt'); // More specific selector
    const uploadText = uploadArea?.querySelector('.upload-text');
    const uploadCollectionSelect = document.getElementById('upload-collection');
    const newCollectionGroup = document.getElementById('new-collection-group');
    const newCollectionInput = document.getElementById('new-collection-name');
    const uploadSubmitBtn = document.getElementById('upload-submit-btn');
    const uploadStatusDiv = document.getElementById('upload-status');
    const selectedFilenameP = document.getElementById('selected-filename');


    // --- State Variables ---
    let allImageData = [];
    let imageObserver = null;
    let selectedFileForUpload = null;

    // --- Core Functions ---

    /**
     * Loads initial data (images and collections) from the server.
     */
    async function loadInitialData() {
        if (!galleryGrid) return;
        showLoadingMessage('Loading gallery...');
        setActiveNavItem(galleryNav); // Ensure gallery is active

        try {
            // Fetch images and collections in parallel
            const [imagesResponse, collectionsResponse] = await Promise.all([
                fetch('/api/images'),
                fetch('/api/collections')
            ]);

            // Process collections first (for upload dropdown)
            if (!collectionsResponse.ok) {
                console.warn('Failed to fetch collections list.');
                populateCollectionDropdown([]); // Populate with default even if fetch fails
            } else {
                const collections = await collectionsResponse.json();
                populateCollectionDropdown(collections);
            }

            // Process images
            if (!imagesResponse.ok) {
                const errorData = await imagesResponse.json().catch(() => ({}));
                throw new Error(`Server error ${imagesResponse.status}: ${errorData.error || 'Failed to fetch images'}`);
            }
            allImageData = await imagesResponse.json();

            if (allImageData.length === 0) {
                showEmptyMessage('No images found. Upload some!');
                updateCategoryTags([]); // Update tags based on empty data
                return;
            }

            // Populate categories based on image data and display
            const imageCollections = [...new Set(allImageData.map(img => img.collection))].filter(c => c && c !== 'root').sort();
            updateCategoryTags(imageCollections); // Pass only actual collections found in images
            displayImages(allImageData);
            setupIntersectionObserver();

        } catch (error) {
            console.error('Error loading initial data:', error);
            showErrorMessage(`Error loading gallery: ${error.message}. Please refresh.`);
            populateCollectionDropdown([]); // Still try to populate dropdown defaults
            updateCategoryTags([]); // Clear category tags on error
        }
    }


    /** Renders image items */
    function displayImages(imageDataList) {
        if (!galleryGrid) return;
        galleryGrid.innerHTML = ''; // Clear previous

        if (imageDataList.length === 0) {
            // Filter function will show "no match" message if needed
            return;
        }

        imageDataList.forEach((image, index) => {
             const item = document.createElement('div');
            item.classList.add('gallery-item');
            item.dataset.title = image.title.toLowerCase();
            item.dataset.filename = image.fileName.toLowerCase();
            item.dataset.collection = image.collection.toLowerCase();
            item.dataset.author = image.author.toLowerCase();
            item.dataset.relativePath = image.relativePath;

            // --- Layout Logic (Optional Example) ---
            // const totalItems = imageDataList.length;
            // if (index === 0 && totalItems > 5) item.classList.add('large-span');
            // else if (index === 2 && totalItems > 7) item.classList.add('medium-span');
             // --- End Layout Logic ---

            const img = document.createElement('img');
            img.src = image.thumbnailUrl;
            img.dataset.src = image.url;
            img.classList.add('lazy');
            img.alt = image.title;
            img.onerror = (e) => handleImageError(e.target, item, image);

            const details = document.createElement('div');
            details.classList.add('image-details');
            details.innerHTML = `
                <div class="image-title" title="${image.title}">${image.title || 'Untitled'}</div>
                <div class="image-author" title="Author: ${image.author || 'Unknown'}">
                    <span class="author-avatar"><i class="fas fa-user"></i></span>
                    <span>${image.author || 'Unknown'}</span>
                </div>
                <div class="image-collection" title="Collection: ${image.collection}">
                   <i class="fas fa-folder-open" style="font-size: 10px; margin-right: 3px;"></i> ${image.collection}
                </div>
            `;

            const actions = document.createElement('div');
            actions.classList.add('image-actions');
            actions.innerHTML = `
                <div class="action-btn" title="Like (NA)"><i class="fas fa-heart"></i></div>
                <div class="action-btn" title="Download ${image.fileName}">
                    <a href="${image.url}" download="${image.fileName}" style="color: inherit; text-decoration: none;">
                        <i class="fas fa-download"></i>
                    </a>
                </div>
                <div class="action-btn" title="Share (NA)"><i class="fas fa-share"></i></div>
            `;

            item.appendChild(img);
            item.appendChild(details);
            item.appendChild(actions);
            galleryGrid.appendChild(item);
        });

        applyFilters();
        observeLazyImages();
    }

    function handleImageError(imgElement, itemElement, imageData) {
         console.error(`Error loading image: ${imgElement.src}`);
         itemElement.innerHTML = `<div class="error-message" style="color: #ff6b6b; padding: 10px; font-size: 12px; text-align: center;">Load Error<br/><small title="${imageData.relativePath}">${imageData.fileName}</small></div>`;
         if (imageObserver) imageObserver.unobserve(imgElement);
    }

    /** Sets up IntersectionObserver */
    function setupIntersectionObserver() {
        // (Same IntersectionObserver setup as previous answer)
        if (imageObserver) imageObserver.disconnect();
        const options = { root: null, rootMargin: '0px 0px 300px 0px', threshold: 0.01 };
        imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const fullSrc = img.dataset.src;
                    if (fullSrc) {
                        img.src = fullSrc;
                        img.classList.add('loaded');
                        img.removeAttribute('data-src');
                    }
                    observer.unobserve(img);
                }
            });
        }, options);
        observeLazyImages();
    }

    /** Observes lazy images */
    function observeLazyImages() {
        // (Same as previous answer)
         if (!imageObserver || !galleryGrid) return;
        const lazyImages = galleryGrid.querySelectorAll('img.lazy:not(.loaded)');
        lazyImages.forEach(img => imageObserver.observe(img));
    }

    /** Applies filters */
    function applyFilters() {
        // (Same filtering logic as previous answer)
         if (!galleryGrid) return;
        const searchTerm = searchInput.value.toLowerCase().trim();
        const activeCategoryElement = categoryTagsContainer.querySelector('.category.active');
        const activeCollection = activeCategoryElement ? activeCategoryElement.dataset.collection.toLowerCase() : 'all';
        let visibleCount = 0;
        const items = galleryGrid.querySelectorAll('.gallery-item');
        items.forEach(item => {
            const titleMatch = item.dataset.title.includes(searchTerm);
            const filenameMatch = item.dataset.filename.includes(searchTerm);
            const searchMatch = titleMatch || filenameMatch;
            const collectionMatch = activeCollection === 'all' || item.dataset.collection === activeCollection;
            if (searchMatch && collectionMatch) { item.style.display = ''; visibleCount++; }
            else { item.style.display = 'none'; }
        });
        handleFilterResults(visibleCount, items.length);
        observeLazyImages();
    }

     /** Shows/hides 'no match' message */
    function handleFilterResults(visibleCount, totalItems) {
        // (Same as previous answer)
         const existingMessage = galleryGrid.querySelector('.gallery-message');
         if (visibleCount === 0 && totalItems > 0) {
             if (!existingMessage) showEmptyMessage('No images match the current filter.');
             else { existingMessage.innerHTML = '<p>No images match the current filter.</p>'; existingMessage.style.color = '#aaa'; }
         } else if (existingMessage) { existingMessage.remove(); }
    }

    // --- UI Update Functions ---
    function showLoadingMessage(message) { /* (Same as previous) */
        if (!galleryGrid) return;
        galleryGrid.innerHTML = `<div class="gallery-message"><p><i class="fas fa-spinner fa-spin"></i> ${message}</p></div>`;
    }
    function showErrorMessage(message) { /* (Same as previous, maybe remove retry button complexity for now) */
         if (!galleryGrid) return;
        galleryGrid.innerHTML = `<div class="gallery-message" style="color: #ff6b6b;"><p><i class="fas fa-exclamation-triangle"></i> ${message}</p></div>`;
    }
    function showEmptyMessage(message) { /* (Same as previous) */
        if (!galleryGrid) return;
        galleryGrid.innerHTML = `<div class="gallery-message"><p>${message}</p></div>`;
    }

    /** Updates category tags, adding download links */
    function updateCategoryTags(collections) {
        if (!categoryTagsContainer) return;
        categoryTagsContainer.innerHTML = '<div class="category active" data-collection="all" title="Show All Collections">All</div>';

        collections.forEach(collectionName => {
            if (!collectionName) return; // Skip if collection name is empty (shouldn't happen often)
            const category = document.createElement('div');
            category.classList.add('category');
            category.dataset.collection = collectionName;
            const displayName = collectionName.charAt(0).toUpperCase() + collectionName.slice(1);
            category.textContent = displayName;
            category.title = `Filter by Collection: ${displayName}`;

            // Add download icon link for this collection
            const downloadLink = document.createElement('a');
            downloadLink.href = `/api/download/collection/${encodeURIComponent(collectionName)}`;
            downloadLink.classList.add('download-collection-icon');
            downloadLink.title = `Download "${displayName}" collection as ZIP`;
            downloadLink.innerHTML = `<i class="fas fa-download"></i>`;
            // Prevent filter click when clicking download icon
            downloadLink.addEventListener('click', (e) => e.stopPropagation());

            category.appendChild(downloadLink);
            categoryTagsContainer.appendChild(category);
        });

        addCategoryListeners();
    }

     /** Attaches click listeners to category tags */
    function addCategoryListeners() { /* (Same as previous) */
        if (!categoryTagsContainer) return;
        const categories = categoryTagsContainer.querySelectorAll('.category');
        categories.forEach(category => {
            category.removeEventListener('click', handleCategoryClick); // Prevent duplicates
            category.addEventListener('click', handleCategoryClick);
        });
    }

     /** Handles category click for filtering */
    function handleCategoryClick() { /* (Same as previous) */
        // Don't filter if the click was on the download icon (already stopped propagation)
        categoryTagsContainer.querySelectorAll('.category').forEach(cat => cat.classList.remove('active'));
        this.classList.add('active');
        applyFilters();
    }

    /** Sets active nav item */
    function setActiveNavItem(activeItem) { /* (Same as previous) */
         document.querySelectorAll('.sidebar .nav-item').forEach(item => item.classList.remove('active'));
        if(activeItem) activeItem.classList.add('active');
    }

    // --- Upload Modal Specific Functions ---

    /** Populates the collection dropdown in the upload modal */
    function populateCollectionDropdown(collections) {
        if (!uploadCollectionSelect) return;
        // Clear existing options except the defaults
        uploadCollectionSelect.innerHTML = `
            <option value="root">Main Directory (root)</option>
             <option value="_new_">-- Create New Collection --</option>
        `;
        collections.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name.charAt(0).toUpperCase() + name.slice(1); // Capitalize
            uploadCollectionSelect.appendChild(option);
        });
         // Reset selection and visibility of new collection input
        uploadCollectionSelect.value = 'root';
        handleCollectionSelectionChange();
    }

    /** Shows/hides the 'new collection' input based on dropdown */
    function handleCollectionSelectionChange() {
        if (!newCollectionGroup || !uploadCollectionSelect) return;
        if (uploadCollectionSelect.value === '_new_') {
            newCollectionGroup.style.display = 'block';
        } else {
            newCollectionGroup.style.display = 'none';
            if(newCollectionInput) newCollectionInput.value = ''; // Clear input when hidden
        }
    }

    function openCreateModal() { /* (Same as previous, calls reset) */
         createModal.style.display = 'flex';
         resetCreateModalForm();
         // Fetch collections again in case they changed since page load
         fetch('/api/collections')
             .then(res => res.ok ? res.json() : [])
             .then(collections => populateCollectionDropdown(collections))
             .catch(err => {
                 console.warn("Failed to refresh collections on modal open:", err);
                 populateCollectionDropdown([]); // Use defaults on error
             });
    }
    function closeCreateModal() { /* (Same as previous) */ createModal.style.display = 'none'; }

    function resetCreateModalForm() { /* (Mostly same, clear status/filename) */
        selectedFileForUpload = null;
        if(uploadPreview) uploadPreview.style.display = 'none';
        if(uploadIcon) uploadIcon.style.display = '';
        if(uploadText) uploadText.style.display = '';
        if(uploadArea) uploadArea.style.borderColor = '#333';
        if(selectedFilenameP) selectedFilenameP.textContent = ''; // Clear filename display
        if(uploadStatusDiv) uploadStatusDiv.textContent = ''; // Clear status
        if(uploadStatusDiv) uploadStatusDiv.className = ''; // Clear status style
        document.getElementById('title').value = '';
        document.getElementById('description').value = '';
        if (uploadCollectionSelect) uploadCollectionSelect.value = 'root'; // Reset dropdown
        handleCollectionSelectionChange(); // Ensure correct visibility
         imageFileInput.value = '';
         if(uploadSubmitBtn) uploadSubmitBtn.disabled = false; // Re-enable button
    }

     function handleFileSelectForUpload(file) { /* (Similar, update filename display) */
         if (file && file.type.startsWith('image/')) {
            selectedFileForUpload = file;
            if(selectedFilenameP) selectedFilenameP.textContent = file.name; // Show filename
            const reader = new FileReader();
            reader.onload = function(e) {
                if(uploadPreview) { uploadPreview.src = e.target.result; uploadPreview.style.display = 'block'; }
                 if(uploadIcon) uploadIcon.style.display = 'none';
                 if(uploadText) uploadText.style.display = 'none';
            }
            reader.readAsDataURL(file);
         } else {
             if (file) alert('Invalid file type. Please select an image.');
             resetCreateModalForm(); // Reset if invalid or no file
         }
     }

    /** Handles the actual file upload */
    async function handleUploadSubmit() {
        if (!selectedFileForUpload) return alert('Please select an image file first.');
        if (!uploadCollectionSelect || !uploadSubmitBtn || !uploadStatusDiv) return;

        const selectedCollection = uploadCollectionSelect.value;
        let newCollectionName = '';

        if (selectedCollection === '_new_') {
            newCollectionName = newCollectionInput?.value.trim() || '';
            if (!newCollectionName) return alert('Please enter a name for the new collection.');
            // Basic validation - server does more robust checks
             if(/[\/\?\<\>\\:\*\|"'\.\s\(\)]+/.test(newCollectionName) || newCollectionName.length > 50){
                 return alert('Invalid collection name. Use simple names, no special characters or spaces.');
             }
        }

        uploadSubmitBtn.disabled = true; // Disable button during upload
        uploadStatusDiv.textContent = 'Uploading...';
        uploadStatusDiv.className = 'loading';

        const formData = new FormData();
        formData.append('imageFile', selectedFileForUpload); // Key matches multer setup
        formData.append('collection', selectedCollection); // 'root', existing name, or '_new_'
        if (selectedCollection === '_new_') {
            formData.append('newCollectionName', newCollectionName);
        }
        // Optionally add other fields like title, description if needed by backend
        // formData.append('title', document.getElementById('title').value);

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
                // Headers not needed for FormData, browser sets correct Content-Type
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || `Upload failed with status ${response.status}`);
            }

            uploadStatusDiv.textContent = `Success! ${result.filename} uploaded to ${result.collection || 'root'}.`;
            uploadStatusDiv.className = 'success';
             // Refresh gallery after a short delay to show success message
            setTimeout(() => {
                closeCreateModal();
                loadInitialData(); // Reload everything
            }, 1500);

        } catch (error) {
            console.error('Upload failed:', error);
            uploadStatusDiv.textContent = `Upload failed: ${error.message}`;
            uploadStatusDiv.className = 'error';
            uploadSubmitBtn.disabled = false; // Re-enable button on error
        }
    }


    // --- Event Listeners ---

    // Search
    if (searchInput) searchInput.addEventListener('input', applyFilters);

    // Refresh
    if (refreshBtnNav) refreshBtnNav.addEventListener('click', loadInitialData); // Use loadInitialData for full refresh
    if (refreshBtnHeader) refreshBtnHeader.addEventListener('click', loadInitialData);

    // Navigation (basic setup)
     document.querySelectorAll('.sidebar .nav-item').forEach(item => {
       if (![createBtnNav, refreshBtnNav, galleryNav].includes(item)) { // Exclude items with specific handlers
           item.addEventListener('click', (e) => { e.preventDefault(); setActiveNavItem(item); /* No action */ });
       }
    });
     if (galleryNav) galleryNav.addEventListener('click', (e) => { e.preventDefault(); setActiveNavItem(galleryNav); applyFilters(); }); // Re-filter gallery view

    // Upload Modal Triggers & Interaction
    if (createBtnHeader) createBtnHeader.addEventListener('click', openCreateModal);
    if (createBtnNav) createBtnNav.addEventListener('click', (e) => { e.preventDefault(); openCreateModal(); setActiveNavItem(createBtnNav); });
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeCreateModal);
    window.addEventListener('click', (event) => { if (event.target === createModal) closeCreateModal(); });
    if (uploadCollectionSelect) uploadCollectionSelect.addEventListener('change', handleCollectionSelectionChange);
    if (uploadSubmitBtn) uploadSubmitBtn.addEventListener('click', handleUploadSubmit);

    // Upload Area File Handling
     if (uploadArea) {
        uploadArea.addEventListener('click', (e) => { if (e.target !== uploadPreview) imageFileInput.click(); });
        uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.style.borderColor = '#9b59b6'; });
        uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = '#333'; });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault(); uploadArea.style.borderColor = '#333';
            const file = e.dataTransfer?.files[0];
            handleFileSelectForUpload(file);
            if(file) imageFileInput.files = e.dataTransfer.files; // Sync input
        });
     }
     if (imageFileInput) {
         imageFileInput.addEventListener('change', (e) => { handleFileSelectForUpload(e.target.files[0]); });
     }

    // --- Initial Load ---
    loadInitialData(); // Fetch images and collections on startup

}); // End DOMContentLoaded