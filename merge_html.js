const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const currentHtml = fs.readFileSync('index.html', 'utf8');
const oldHtml = fs.readFileSync('index_16b57e5.html', 'utf8');

const currentDom = new JSDOM(currentHtml);
const oldDom = new JSDOM(oldHtml);

const currentDoc = currentDom.window.document;
const oldDoc = oldDom.window.document;

// 1. Copy Dashboard view
const dashboardView = oldDoc.getElementById('view-dashboard');
if (dashboardView && !currentDoc.getElementById('view-dashboard')) {
    const mainContent = currentDoc.querySelector('main');
    if (mainContent) {
        mainContent.insertBefore(dashboardView, currentDoc.getElementById('view-pos'));
        console.log("Added view-dashboard");
    }
}

// 2. Copy Analytics view
const analyticsView = oldDoc.getElementById('view-analytics');
if (analyticsView && !currentDoc.getElementById('view-analytics')) {
    const mainContent = currentDoc.querySelector('main');
    if (mainContent) {
        mainContent.appendChild(analyticsView);
        console.log("Added view-analytics");
    }
}

// 3. Copy Calculadora Modal
const calcModal = oldDoc.getElementById('calculadora-modal');
if (calcModal && !currentDoc.getElementById('calculadora-modal')) {
    currentDoc.body.appendChild(calcModal);
    console.log("Added calculadora-modal");
}

// 4. Update Navigation Sidebar
// Let's add the Dashboard item at the top of the menu if it doesn't exist
const navMenu = currentDoc.querySelector('nav');
if (navMenu && !currentDoc.getElementById('nav-dashboard')) {
    const dashboardNav = oldDoc.getElementById('nav-dashboard');
    if (dashboardNav) {
        navMenu.insertBefore(dashboardNav, navMenu.firstChild);
        console.log("Added nav-dashboard");
    }
}

// Add Analytics under Reports
if (navMenu && !currentDoc.getElementById('nav-analytics')) {
    const analyticsNav = oldDoc.getElementById('nav-analytics');
    if (analyticsNav) {
        // Find reports
        const reportsNav = currentDoc.getElementById('nav-reports');
        if (reportsNav && reportsNav.nextSibling) {
            navMenu.insertBefore(analyticsNav, reportsNav.nextSibling);
            console.log("Added nav-analytics");
        } else {
            navMenu.appendChild(analyticsNav);
            console.log("Added nav-analytics to bottom");
        }
    }
}

fs.writeFileSync('index_merged.html', currentDom.serialize());
console.log("Merged HTML written to index_merged.html");
