const previewFont = new URLSearchParams(location.search).get('font') || localStorage.getItem('pm-preview-font') || 'modern';
document.documentElement.dataset.typography = ['modern', 'system', 'editorial'].includes(previewFont) ? previewFont : 'modern';
