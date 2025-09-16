// standardize-spread2.js
// Phase 1.5: Standardize CCAA names in spread2 before merging

const XLSX = require('xlsx');
const _ = require('lodash');
const fs = require('fs');
const path = require('path');

// =====================================================================
// STANDARDIZATION MAPPING
// =====================================================================

// Complete mapping for all possible region name variations
const REGION_STANDARDIZATION = {
    // Already correct official names
    'Andalucía': 'Andalucía',
    'Aragón': 'Aragón', 
    'Principado de Asturias': 'Principado de Asturias',
    'Illes Balears': 'Illes Balears',
    'Canarias': 'Canarias',
    'Cantabria': 'Cantabria',
    'Castilla-La Mancha': 'Castilla-La Mancha',
    'Castilla y León': 'Castilla y León',
    'Cataluña': 'Cataluña',
    'Comunitat Valenciana': 'Comunitat Valenciana',
    'Extremadura': 'Extremadura',
    'Galicia': 'Galicia',
    'Comunidad de Madrid': 'Comunidad de Madrid',
    'Región de Murcia': 'Región de Murcia',
    'Comunidad Foral de Navarra': 'Comunidad Foral de Navarra',
    'País Vasco': 'País Vasco',
    'La Rioja': 'La Rioja',
    'Ceuta': 'Ceuta',
    'Melilla': 'Melilla',
    'Estado Español': 'Estado Español',
    
    // Common variations to standardize
    'País Valencià': 'Comunitat Valenciana',
    'Comunidad Valenciana': 'Comunitat Valenciana',
    'Pais Valencià': 'Comunitat Valenciana',
    'Valencia': 'Comunitat Valenciana',
    'Comunitat Valencia': 'Comunitat Valenciana',
    
    'Catalunya': 'Cataluña',
    'Catalonia': 'Cataluña',
    
    'Asturias': 'Principado de Asturias',
    'Asturies': 'Principado de Asturias',
    
    'Madrid': 'Comunidad de Madrid',
    
    'Murcia': 'Región de Murcia',
    
    'Castilla León': 'Castilla y León',
    'Castilla-León': 'Castilla y León',
    
    'Castilla La Mancha': 'Castilla-La Mancha',
    'Castilla la Mancha': 'Castilla-La Mancha',
    
    'Baleares': 'Illes Balears',
    'Islas Baleares': 'Illes Balears',
    'Balears': 'Illes Balears',
    
    'Navarra': 'Comunidad Foral de Navarra',
    'Nafarroa': 'Comunidad Foral de Navarra',
    
    'Euskadi': 'País Vasco',
    'Pais Vasco': 'País Vasco',
    'Basque Country': 'País Vasco',
    
    'Rioja': 'La Rioja',
    
    'Islas Canarias': 'Canarias',
    
    // Handle null/empty values
    '': 'Sin especificar',
    null: 'Sin especificar',
    undefined: 'Sin especificar'
};

// =====================================================================
// UTILITY FUNCTIONS
// =====================================================================

function standardizeRegionName(regionName) {
    if (!regionName) return 'Sin especificar';
    
    const trimmed = regionName.trim();
    
    // Direct match
    if (REGION_STANDARDIZATION[trimmed]) {
        return REGION_STANDARDIZATION[trimmed];
    }
    
    // Case-insensitive match
    const lowerCase = trimmed.toLowerCase();
    for (const [variant, standard] of Object.entries(REGION_STANDARDIZATION)) {
        if (variant.toLowerCase() === lowerCase) {
            return standard;
        }
    }
    
    // Partial match for common mistakes
    if (lowerCase.includes('valenc')) return 'Comunitat Valenciana';
    if (lowerCase.includes('catalu') || lowerCase.includes('catalo')) return 'Cataluña';
    if (lowerCase.includes('astur')) return 'Principado de Asturias';
    if (lowerCase.includes('madrid')) return 'Comunidad de Madrid';
    if (lowerCase.includes('murcia')) return 'Región de Murcia';
    if (lowerCase.includes('castilla') && lowerCase.includes('león')) return 'Castilla y León';
    if (lowerCase.includes('castilla') && lowerCase.includes('mancha')) return 'Castilla-La Mancha';
    if (lowerCase.includes('balear')) return 'Illes Balears';
    if (lowerCase.includes('canaria')) return 'Canarias';
    if (lowerCase.includes('andaluc')) return 'Andalucía';
    if (lowerCase.includes('galicia')) return 'Galicia';
    if (lowerCase.includes('aragon')) return 'Aragón';
    if (lowerCase.includes('extremadura')) return 'Extremadura';
    if (lowerCase.includes('cantabria')) return 'Cantabria';
    if (lowerCase.includes('navarra')) return 'Comunidad Foral de Navarra';
    if (lowerCase.includes('vasco') || lowerCase.includes('euskadi')) return 'País Vasco';
    if (lowerCase.includes('rioja')) return 'La Rioja';
    
    console.log(`⚠️  Unknown region: "${trimmed}" - keeping as is`);
    return trimmed; // Keep original if no match found
}

function cleanText(text) {
    if (!text || typeof text !== 'string') return '';
    return text.trim()
               .replace(/\s+/g, ' ')
               .replace(/^\s*⁠\s*/, '')
               .replace(/\u2060/g, '')
               .replace(/\u00A0/g, ' ')
               .replace(/[\u200B-\u200D\uFEFF]/g, '');
}

// =====================================================================
// MAIN PROCESSING FUNCTION
// =====================================================================

function standardizeSpread2() {
    try {
        console.log("=== PHASE 1.5: STANDARDIZING SPREAD2 REGIONS ===");
        
        // Check if file exists
        const inputPath = path.join(__dirname, 'spread2.xlsx');
        if (!fs.existsSync(inputPath)) {
            throw new Error('spread2.xlsx not found!');
        }
        
        console.log("Reading spread2.xlsx...");
        const workbook = XLSX.readFile(inputPath);
        const sheetName = workbook.SheetNames[0];
        const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
        
        console.log(`Original data: ${rawData.length} records`);
        console.log("Sample original regions found:");
        
        // Analyze current regions
        const originalRegions = {};
        rawData.forEach(record => {
            const region = record.region || 'Empty/Null';
            originalRegions[region] = (originalRegions[region] || 0) + 1;
        });
        
        Object.entries(originalRegions)
            .sort(([,a], [,b]) => b - a)
            .forEach(([region, count]) => {
                console.log(`  "${region}": ${count} records`);
            });
        
        console.log("\nStandardizing regions...");
        
        // Process and standardize data
        const standardizedData = rawData.map(record => {
            const originalRegion = record.region;
            const standardizedRegion = standardizeRegionName(originalRegion);
            
            return {
                representative: cleanText(record.representative) || '',
                center: cleanText(record.center) || '',
                email: cleanText(record.email) || '',
                department: cleanText(record.department) || '',
                locality: cleanText(record.locality) || '',
                province: cleanText(record.province) || '',
                region: standardizedRegion,
                commitments: cleanText(record.commitments) || '',
                additional: cleanText(record.additional) || '',
                date: record.date || '',
                _original_region: originalRegion // Keep track of original for reference
            };
        });
        
        // Analyze standardized regions
        console.log("\nStandardized regions:");
        const standardizedRegions = {};
        const regionChanges = [];
        
        standardizedData.forEach(record => {
            const newRegion = record.region;
            const oldRegion = record._original_region;
            
            standardizedRegions[newRegion] = (standardizedRegions[newRegion] || 0) + 1;
            
            if (oldRegion !== newRegion) {
                regionChanges.push({ from: oldRegion, to: newRegion });
            }
        });
        
        Object.entries(standardizedRegions)
            .sort(([,a], [,b]) => b - a)
            .forEach(([region, count]) => {
                console.log(`  "${region}": ${count} records`);
            });
        
        console.log(`\nChanges made: ${regionChanges.length} regions standardized`);
        if (regionChanges.length > 0) {
            console.log("Region changes:");
            const changesSummary = _.groupBy(regionChanges, change => `${change.from} → ${change.to}`);
            Object.entries(changesSummary).forEach(([change, instances]) => {
                console.log(`  ${change} (${instances.length} records)`);
            });
        }
        
        // Create export workbook
        const exportWorkbook = XLSX.utils.book_new();
        
        // Main corrected data (remove metadata column for clean export)
        const cleanData = standardizedData.map(record => {
            const clean = {};
            ['representative', 'center', 'email', 'department', 'locality', 
             'province', 'region', 'commitments', 'additional', 'date'].forEach(col => {
                clean[col] = record[col];
            });
            return clean;
        });
        
        const dataSheet = XLSX.utils.json_to_sheet(cleanData);
        XLSX.utils.book_append_sheet(exportWorkbook, dataSheet, "Corrected_Data");
        
        // Changes report
        const changesReport = Object.entries(_.groupBy(regionChanges, 'from')).map(([from, changes]) => ({
            original_region: from,
            standardized_region: changes[0].to,
            records_changed: changes.length
        }));
        
        if (changesReport.length > 0) {
            const changesSheet = XLSX.utils.json_to_sheet(changesReport);
            XLSX.utils.book_append_sheet(exportWorkbook, changesSheet, "Region_Changes");
        }
        
        // Statistics
        const stats = [
            { metric: 'Total Records', value: standardizedData.length },
            { metric: 'Regions Standardized', value: regionChanges.length },
            { metric: 'Unique Regions (final)', value: Object.keys(standardizedRegions).length },
            { metric: 'Records with Email', value: cleanData.filter(r => r.email).length },
            { metric: 'Records with Representative', value: cleanData.filter(r => r.representative).length },
            { metric: '', value: '' },
            { metric: 'FINAL REGIONS:', value: '' }
        ];
        
        Object.entries(standardizedRegions)
            .sort(([,a], [,b]) => b - a)
            .forEach(([region, count]) => {
                stats.push({ metric: region, value: count });
            });
        
        const statsSheet = XLSX.utils.json_to_sheet(stats);
        XLSX.utils.book_append_sheet(exportWorkbook, statsSheet, "Statistics");
        
        // Write file
        const outputPath = path.join(__dirname, 'spread2_corrected.xlsx');
        XLSX.writeFile(exportWorkbook, outputPath);
        
        console.log(`\n✅ Standardized spread2 exported to: spread2_corrected.xlsx`);
        console.log(`📊 Total records: ${standardizedData.length}`);
        console.log(`🔄 Regions changed: ${regionChanges.length}`);
        console.log(`🗺️  Final unique regions: ${Object.keys(standardizedRegions).length}`);
        
        // Validation
        const unknownRegions = Object.keys(standardizedRegions).filter(region => 
            !Object.values(REGION_STANDARDIZATION).includes(region) && 
            region !== 'Sin especificar'
        );
        
        if (unknownRegions.length > 0) {
            console.log(`\n⚠️  Unknown regions detected (please review):`);
            unknownRegions.forEach(region => {
                console.log(`  - "${region}"`);
            });
        }
        
        return {
            success: true,
            totalRecords: standardizedData.length,
            changesCount: regionChanges.length,
            finalRegions: Object.keys(standardizedRegions).length,
            outputFile: outputPath
        };
        
    } catch (error) {
        console.error("❌ Standardization failed:", error.message);
        return { success: false, error: error.message };
    }
}

// =====================================================================
// RUN THE SCRIPT
// =====================================================================

console.log("Starting spread2 region standardization...");
console.log("This will create spread2_corrected.xlsx with standardized CCAA names.\n");

const result = standardizeSpread2();

if (result.success) {
    console.log("\n🎉 SUCCESS! Spread2 regions have been standardized.");
    console.log("📁 Next step: Run the merge script with both corrected files.");
    console.log("\nYour files are now ready:");
    console.log("  ✅ spread1_corrected.xlsx");
    console.log("  ✅ spread2_corrected.xlsx");
    console.log("\nRun: node merge-datasets.js");
} else {
    console.log("\n💥 FAILED! Check the error message above.");
}