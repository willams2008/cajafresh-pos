document.addEventListener('DOMContentLoaded', () => {
    // Theme switcher logic
    const colorPickerBtns = document.querySelectorAll('.color-picker-btn');

    // Load saved theme
    const savedTheme = localStorage.getItem('freshpos-theme') || 'blue';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateActiveButton(savedTheme);

    colorPickerBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.getAttribute('data-theme');
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('freshpos-theme', theme);
            updateActiveButton(theme);
        });
    });

    function updateActiveButton(theme) {
        colorPickerBtns.forEach(btn => {
            if (btn.getAttribute('data-theme') === theme) {
                btn.style.opacity = '1';
                btn.classList.add('ring-2', 'ring-brand-500', 'ring-offset-1', 'dark:ring-offset-slate-900');
            } else {
                btn.style.opacity = '0.5';
                btn.classList.remove('ring-2', 'ring-brand-500', 'ring-offset-1', 'dark:ring-offset-slate-900');
            }
        });
    }

    // Dark mode logic
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
        const themeIcon = document.getElementById('theme-icon');
        const isDark = localStorage.getItem('freshpos-darkmode') === 'true';

        if (isDark) {
            document.documentElement.classList.add('dark');
            themeIcon.classList.replace('fa-moon', 'fa-sun');
        }

        themeToggleBtn.addEventListener('click', () => {
            document.documentElement.classList.toggle('dark');
            const newIsDark = document.documentElement.classList.contains('dark');
            localStorage.setItem('freshpos-darkmode', newIsDark);
            
            if (newIsDark) {
                themeIcon.classList.replace('fa-moon', 'fa-sun');
            } else {
                themeIcon.classList.replace('fa-sun', 'fa-moon');
            }
        });
    }
});
