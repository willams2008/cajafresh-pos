const fs = require('fs');

let current = fs.readFileSync('index.html', 'utf8');
const oldHtml = fs.readFileSync('index_16b57e5.html', 'utf8');

// Dashboard View
const dashMatch = oldHtml.split('<section id="view-dashboard"');
if (dashMatch.length > 1) {
    const sectionContent = '<section id="view-dashboard"' + dashMatch[1].split('</section>')[0] + '</section>';
    if (!current.includes('id="view-dashboard"')) {
        current = current.replace('<section id="view-pos"', sectionContent + '\n\n        <!-- === VISTA POS === -->\n        <section id="view-pos"');
        console.log("Added Dashboard view");
    } else {
        console.log("Dashboard already exists in current");
    }
} else {
    console.log("Could not find view-dashboard in oldHtml");
}

// Analytics View
const analMatch = oldHtml.split('<section id="view-analytics"');
if (analMatch.length > 1) {
    const sectionContent = '<section id="view-analytics"' + analMatch[1].split('</section>')[0] + '</section>';
    if (!current.includes('id="view-analytics"')) {
        current = current.replace('</main>', sectionContent + '\n    </main>');
        console.log("Added Analytics view");
    } else {
        console.log("Analytics already exists in current");
    }
}

// Nav Dashboard
const navMatch = oldHtml.split('<a href="#" id="nav-dashboard"');
if (navMatch.length > 1) {
    const sectionContent = '<a href="#" id="nav-dashboard"' + navMatch[1].split('</a>')[0] + '</a>';
    if (!current.includes('id="nav-dashboard"')) {
        // Insert right after the top level nav opening
        current = current.replace('<nav class="space-y-1.5 mt-4">', '<nav class="space-y-1.5 mt-4">\n' + sectionContent);
        console.log("Added Nav Dashboard");
    }
}

// Nav Analytics
const navAnalMatch = oldHtml.split('<a href="#" id="nav-analytics"');
if (navAnalMatch.length > 1) {
    const sectionContent = '<a href="#" id="nav-analytics"' + navAnalMatch[1].split('</a>')[0] + '</a>';
    if (!current.includes('id="nav-analytics"')) {
        // Insert after nav-reports
        const repMatch = current.split('<a href="#" id="nav-reports"');
        if (repMatch.length > 1) {
            const repContent = '<a href="#" id="nav-reports"' + repMatch[1].split('</a>')[0] + '</a>';
            current = current.replace(repContent, repContent + '\n' + sectionContent);
            console.log("Added Nav Analytics");
        }
    }
}

fs.writeFileSync('index.html', current);
console.log("Merge script finished.");
