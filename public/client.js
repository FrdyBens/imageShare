document.addEventListener('DOMContentLoaded', function() {
    // ... (keep existing variable declarations: galleryGrid, searchInput, etc.) ...
    const galleryGrid = document.querySelector('.gallery-grid');
    const searchInput = document.getElementById('search-input');
    const categoryTagsContainer = document.querySelector('.category-tags');
    const createModal = document.getElementById('create-modal');
    // ... (include all other necessary element selections) ...
    const galleryNav = document.getElementById('gallery-nav');

    let allImageData = [];
    let imageObserver = null; // Store the IntersectionObserver instance

    // --- Intersection Observer for Lazy Loading ---
    function setupIntersectionObserver() {
        // Disconnect previous observer if it exists
        if (imageObserver) {
            imageObserver.disconnect();
        }

        const options = {
            root: null, // Use the viewport as the root
            rootMargin: '0px 0px 200px 0px', // Load images 200px before they enter viewport
            threshold: 0.01 // Trigger when even 1% is visible
        };

        imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const fullSrc = img.dataset.src; // Get the full image URL

                    if (fullSrc) {
                        img.src = fullSrc; // Load the full image
                        img.classList.add('loaded'); // Mark as loaded (for potential CSS transitions)
                        img.removeAttribute('data-src'); // Clean up data attribute
                    }
                    observer.unobserve(img); // Stop observing once loaded
                }
            });
        }, options);

        // Observe all images currently marked for lazy loading
        observeLazyImages();
    }

    function observeLazyImages() {
        if (!imageObserver || !galleryGrid) return;
        const lazyImages = galleryGrid.querySelectorAll('img.lazy:not(.loaded)');
        lazyImages.forEach(img => imageObserver.observe(img));
    }

    // --- Initial Load & Refresh ---
    async function loadImagesFromServer() {
        if (!galleryGrid) {
            console.error("Gallery grid container not found!");
            return;
        }
        galleryGrid.innerHTML = '<div class="gallery-message"><p><i class="fas fa-spinner fa-spin"></i> Loading images...</p></div>';

        try {
            const response = await fetch('/api/images');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            allImageData = await response.json();

            if (allImageData.length === 0) {
                galleryGrid.innerHTML = '<div class="gallery-message"><p>No images found on the server.</p></div>';
                updateCategoryTags([]);
                return;
            }

            const collections = [...new Set(allImageData.map(img => img.collection))].sort();
            updateCategoryTags(collections);
            displayImages(allImageData); // Display images uses the data
            setupIntersectionObserver(); // Setup observer AFTER images are in the DOM

        } catch (error) {
            console.error('Error fetching images:', error);
            galleryGrid.innerHTML = `<div class="gallery-message"><p style="color: red;">Error loading images: ${error.message}</p><button id="retry-load">Retry</button></div>`;
            document.getElementById('retry-load')?.addEventListener('click', loadImagesFromServer);
        }
    }

    // --- Display Images in Grid (MODIFIED for Lazy Loading) ---
    function displayImages(imageDataList) {
        if (!galleryGrid) return;
        galleryGrid.innerHTML = ''; // Clear previous

        if (imageDataList.length === 0) {
            galleryGrid.innerHTML = '<div class="gallery-message"><p>No images match the current filter.</p></div>';
            return;
        }

        imageDataList.forEach((image, index) => {
            const item = document.createElement('div');
            item.classList.add('gallery-item');
            // Add data attributes (keep these)
            item.dataset.title = image.title.toLowerCase();
            item.dataset.filename = image.fileName.toLowerCase();
            item.dataset.collection = image.collection.toLowerCase();
            item.dataset.author = image.author.toLowerCase();

            // Layout logic (keep or adjust as needed)
            const totalItems = imageDataList.length;
             if (index === 0 && totalItems > 5) item.classList.add('large-span');
             else if (index === 1 && totalItems > 8) item.classList.add('medium-span');
             else if (index === 4 && totalItems > 10) item.classList.add('medium-span');

            const img = document.createElement('img');
            // **** LAZY LOADING CHANGE ****
            img.src = image.thumbnailUrl; // Load THUMBNAIL initially
            img.dataset.src = image.url;     // Store FULL image URL in data-src
            img.classList.add('lazy');       // Add class for the observer to find
            // **** END LAZY LOADING CHANGE ****

            img.alt = image.title;
            // img.loading = 'lazy'; // Browser native lazy loading can conflict or be redundant with observer, often better to rely on observer
            img.onerror = (e) => {
                // Handle error for both thumbnail and full image load attempts
                console.error(`Error loading image: ${e.target.src}`);
                item.innerHTML = `<div style="color:red; padding: 10px; font-size: 12px; text-align: center;">Error loading preview<br/><small>${image.fileName}</small></div>`;
                 // If it was the thumbnail that failed, remove the data-src so observer doesn't try full res
                 if (e.target.src === image.thumbnailUrl) {
                     e.target.removeAttribute('data-src');
                 }
                 imageObserver?.unobserve(e.target); // Stop observing failed images
            };

            // Details and Actions remain the same...
            const details = document.createElement('div');
            details.classList.add('image-details');
            // ... (inner HTML for details as before, including collection) ...
            details.innerHTML = `
                <div class="image-title" title="${image.title}">${image.title || 'Untitled'}</div>
                <div class="image-author">
                    <span class="author-avatar"><i class="fas fa-user"></i></span>
                    <span title="${image.author}">${image.author || 'Unknown'}</span>
                </div>
                <div class="image-collection" style="font-size: 10px; color: #aaa; margin-top: 3px;">
                   Collection: ${image.collection}
                </div>
            `;


            const actions = document.createElement('div');
            actions.classList.add('image-actions');
            // ... (inner HTML for actions as before) ...
            actions.innerHTML = `
                <div class="action-btn" title="Like"><i class="fas fa-heart"></i></div>
                <div class="action-btn" title="Download ${image.fileName}">
                    <a href="${image.url}" download="${image.fileName}" style="color: inherit; text-decoration: none;">
                        <i class="fas fa-download"></i>
                    </a>
                </div>
                <div class="action-btn" title="Share (Not functional)"><i class="fas fa-share"></i></div>
            `;


            item.appendChild(img);
            item.appendChild(details);
            item.appendChild(actions);
            galleryGrid.appendChild(item);
        });

        // Re-apply filters and observe new images
        applyFilters();
        observeLazyImages(); // Tell observer about the newly added images
    }

    // --- Filtering Logic (MODIFIED to re-observe after filtering) ---
    function applyFilters() {
        // ... (keep the existing filter logic based on search and category) ...
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

            if (searchMatch && collectionMatch) {
                item.style.display = ''; // Show item
                visibleCount++;
            } else {
                item.style.display = 'none'; // Hide item
            }
        });

        // Update "no match" message
        const noMatchMessage = galleryGrid.querySelector('.gallery-message');
        if (visibleCount === 0 && items.length > 0 && !noMatchMessage) { // Only show if items exist but none match
             const messageDiv = document.createElement('div');
             messageDiv.classList.add('gallery-message');
             messageDiv.innerHTML = '<p>No images match the current filter.</p>';
             // Append after the last item or at the end
             galleryGrid.appendChild(messageDiv);
        } else if (visibleCount > 0 && noMatchMessage) {
            noMatchMessage.remove();
        }

        // IMPORTANT: Re-evaluate which images need observing after filtering changes visibility
        // This ensures images revealed by filtering are loaded if in view.
         observeLazyImages();
    }

    // --- Search Input Handler (No change needed, calls applyFilters) ---
    if (searchInput) {
        searchInput.addEventListener('input', applyFilters);
    }

    // --- Category Tag Handling (No change needed, calls applyFilters) ---
    // ... (keep updateCategoryTags, addCategoryListeners, handleCategoryClick) ...
     function updateCategoryTags(collections) {
        if (!categoryTagsContainer) return;
        categoryTagsContainer.innerHTML = '<div class="category active" data-collection="all">All</div>';
        collections.forEach(collectionName => {
            const category = document.createElement('div');
            category.classList.add('category');
            category.dataset.collection = collectionName;
            category.textContent = collectionName.charAt(0).toUpperCase() + collectionName.slice(1);
             category.title = `Filter by collection: ${collectionName}`;
            categoryTagsContainer.appendChild(category);
        });
        addCategoryListeners();
    }
    function addCategoryListeners() { /* ...as before... */
         const categories = categoryTagsContainer.querySelectorAll('.category');
         categories.forEach(category => {
             category.removeEventListener('click', handleCategoryClick);
             category.addEventListener('click', handleCategoryClick);
         });
    }
    function handleCategoryClick() { /* ...as before... */
        categoryTagsContainer.querySelectorAll('.category').forEach(cat => cat.classList.remove('active'));
        this.classList.add('active');
        applyFilters();
    }


    // --- Create Modal Logic (No change needed) ---
    // ... (keep all create modal functions: open/close, file handling, publish simulation) ...

    // --- Navigation Active State (No change needed) ---
    // ... (keep setActiveNavItem and related listeners) ...

    // --- Initial Actions ---
    loadImagesFromServer(); // Load images on page load
    setActiveNavItem(galleryNav); // Set Gallery active initially

}); // End DOMContentLoaded