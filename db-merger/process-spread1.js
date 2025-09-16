// process-spread1.js
// Node.js script to process and export corrected spread1 data

const XLSX = require('xlsx');
const _ = require('lodash');
const fs = require('fs');
const path = require('path');

// =====================================================================
// CONFIGURATION
// =====================================================================

const CCAA_MAPPING = {
    'CANTABRIA': 'Cantabria',
    'CASTILLA LEÓN': 'Castilla y León',
    'CASTILLA LA MANCHA': 'Castilla-La Mancha', 
    'CATALUNYA': 'Cataluña',
    'EXTREMADURA': 'Extremadura',
    'MADRID': 'Comunidad de Madrid',
    'MURCIA': 'Región de Murcia',
    'PAÍS VALENCIÀ': 'Comunitat Valenciana',
    'CANARIAS': 'Canarias',
    'ANDALUCIA': 'Andalucía',
    ' ASTURIES': 'Principado de Asturias',
    'ASOCIACIONES, COLECTIVOS': 'Estado Español'
};

const TARGET_COLUMNS = [
    'representative',
    'center', 
    'email',
    'department',
    'locality',
    'province',
    'region',
    'commitments',
    'additional',
    'date'
];

// =====================================================================
// UTILITY FUNCTIONS
// =====================================================================

function cleanText(text) {
    if (!text || typeof text !== 'string') return '';
    return text.trim()
               .replace(/\s+/g, ' ')
               .replace(/^\s*⁠\s*/, '')
               .replace(/\u2060/g, '')
               .replace(/\u00A0/g, ' ')
               .replace(/[\u200B-\u200D\uFEFF]/g, '');
}

function detectColumnStructure(row, sheetName, allSheetData) {
    const nonEmptyCells = row.filter(cell => cell !== null && cell !== undefined && cell !== '');
    const numCols = nonEmptyCells.length;
    
    console.log(`  Analyzing ${sheetName}: ${numCols} columns`);
    
    if (numCols === 1) {
        return { type: 'center_only', center: 0 };
    } else if (numCols === 2) {
        return { type: 'locality_center', locality: 0, center: 1 };
    } else if (numCols === 3) {
        // Check if third column contains observations
        const thirdColSamples = allSheetData.slice(0, 5).map(row => row[2]).filter(val => val);
        const hasObservations = thirdColSamples.some(val => 
            val && typeof val === 'string' && (
                val.length > 50 || 
                val.toLowerCase().includes('claustro') || 
                val.toLowerCase().includes('consejo') || 
                val.toLowerCase().includes('asamblea') ||
                val.toLowerCase().includes('ampa') ||
                val.toLowerCase().includes('unanimidad') ||
                val.toLowerCase().includes('comunicado')
            )
        );
        
        if (hasObservations) {
            return { type: 'locality_center_obs', locality: 0, center: 1, observations: 2 };
        } else {
            return { type: 'province_locality_center', province: 0, locality: 1, center: 2 };
        }
    } else if (numCols >= 4) {
        return { type: 'province_locality_center_obs', province: 0, locality: 1, center: 2, observations: 3 };
    }
    
    return { type: 'unknown' };
}

function extractSheetData(workbook, sheetName) {
    console.log(`\n--- Processing ${sheetName} ---`);
    
    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    // Filter out completely empty rows
    const nonEmptyRows = rawData.filter(row => 
        row.some(cell => cell !== null && cell !== undefined && cell !== '')
    );
    
    if (nonEmptyRows.length === 0) {
        console.log(`  No data found in ${sheetName}`);
        return [];
    }
    
    console.log(`  Raw rows: ${rawData.length}, Non-empty: ${nonEmptyRows.length}`);
    
    // Detect structure
    const structure = detectColumnStructure(nonEmptyRows[0], sheetName, nonEmptyRows);
    console.log(`  Structure detected: ${structure.type}`);
    
    const extractedData = [];
    
    for (let i = 0; i < nonEmptyRows.length; i++) {
        const row = nonEmptyRows[i];
        
        if (row.every(cell => !cell || cell === '')) continue;
        
        const record = {
            representative: '',
            center: '',
            email: '',
            department: '',
            locality: '',
            province: '',
            region: CCAA_MAPPING[sheetName] || sheetName,
            commitments: '',
            additional: '',
            date: ''
        };
        
        // Map columns based on structure
        switch (structure.type) {
            case 'center_only':
                record.center = cleanText(row[structure.center]);
                break;
                
            case 'locality_center':
                record.locality = cleanText(row[structure.locality]);
                record.center = cleanText(row[structure.center]);
                break;
                
            case 'locality_center_obs':
                record.locality = cleanText(row[structure.locality]);
                record.center = cleanText(row[structure.center]);
                record.additional = cleanText(row[structure.observations]);
                break;
                
            case 'province_locality_center':
                record.province = cleanText(row[structure.province]);
                record.locality = cleanText(row[structure.locality]);
                record.center = cleanText(row[structure.center]);
                break;
                
            case 'province_locality_center_obs':
                record.province = cleanText(row[structure.province]);
                record.locality = cleanText(row[structure.locality]);
                record.center = cleanText(row[structure.center]);
                record.additional = cleanText(row[structure.observations]);
                break;
        }
        
        // Skip records without center name
        if (!record.center) {
            console.log(`  Skipping row ${i + 1}: no center name`);
            continue;
        }
        
        extractedData.push(record);
    }
    
    console.log(`  Extracted: ${extractedData.length} valid records`);
    return extractedData;
}

// =====================================================================
// MAIN PROCESSING FUNCTION
// =====================================================================

function processspread1() {
    try {
        console.log("=== SPREAD1 CORRECTION AND EXPORT ===");
        
        // Check if files exist
        const spread1Path = path.join(__dirname, 'spread1.xlsx');
        if (!fs.existsSync(spread1Path)) {
            throw new Error('spread1.xlsx not found! Please place it in the same folder as this script.');
        }
        
        console.log("Reading spread1.xlsx...");
        const workbook1 = XLSX.readFile(spread1Path);
        
        console.log("Sheets found:", workbook1.SheetNames);
        
        // Process all sheets
        let allExtractedData = [];
        const processingReport = [];
        
        for (const sheetName of workbook1.SheetNames) {
            try {
                const sheetData = extractSheetData(workbook1, sheetName);
                allExtractedData = allExtractedData.concat(sheetData);
                
                processingReport.push({
                    sheet: sheetName,
                    region: CCAA_MAPPING[sheetName] || sheetName,
                    records_extracted: sheetData.length,
                    status: 'SUCCESS'
                });
                
            } catch (error) {
                console.log(`ERROR processing ${sheetName}:`, error.message);
                processingReport.push({
                    sheet: sheetName,
                    region: CCAA_MAPPING[sheetName] || sheetName,
                    records_extracted: 0,
                    status: 'ERROR',
                    error_message: error.message
                });
            }
        }
        
        // Summary
        console.log("\n=== EXTRACTION SUMMARY ===");
        console.log(`Total records extracted: ${allExtractedData.length}`);
        
        const byRegion = _.groupBy(allExtractedData, 'region');
        console.log("\nRecords by region:");
        Object.entries(byRegion).forEach(([region, records]) => {
            console.log(`  ${region}: ${records.length}`);
        });
        
        // Create export workbook
        const exportWorkbook = XLSX.utils.book_new();
        
        // Main data sheet
        const exportData = allExtractedData.map(record => {
            const cleanRecord = {};
            TARGET_COLUMNS.forEach(col => {
                cleanRecord[col] = record[col] || '';
            });
            return cleanRecord;
        });
        
        const dataSheet = XLSX.utils.json_to_sheet(exportData);
        XLSX.utils.book_append_sheet(exportWorkbook, dataSheet, "Corrected_Data");
        
        // Processing report sheet
        const reportSheet = XLSX.utils.json_to_sheet(processingReport);
        XLSX.utils.book_append_sheet(exportWorkbook, reportSheet, "Processing_Report");
        
        // Statistics sheet
        const stats = [
            { metric: 'Total Records', value: allExtractedData.length },
            { metric: 'Sheets Processed', value: workbook1.SheetNames.length },
            { metric: 'Successful Sheets', value: processingReport.filter(r => r.status === 'SUCCESS').length },
            { metric: 'Records with Locality', value: exportData.filter(r => r.locality).length },
            { metric: 'Records with Province', value: exportData.filter(r => r.province).length },
            { metric: 'Records with Observations', value: exportData.filter(r => r.additional).length }
        ];
        
        Object.entries(byRegion).forEach(([region, records]) => {
            stats.push({ metric: `${region} Records`, value: records.length });
        });
        
        const statsSheet = XLSX.utils.json_to_sheet(stats);
        XLSX.utils.book_append_sheet(exportWorkbook, statsSheet, "Statistics");
        
        // Write file
        const outputPath = path.join(__dirname, 'spread1_corrected.xlsx');
        XLSX.writeFile(exportWorkbook, outputPath);
        
        console.log("\n✅ Export completed successfully!");
        console.log(`📁 File saved as: ${outputPath}`);
        console.log(`📊 Total records: ${allExtractedData.length}`);
        
        // Validation
        console.log("\n=== DATA VALIDATION ===");
        const withCenter = exportData.filter(r => r.center).length;
        const withLocality = exportData.filter(r => r.locality).length;
        const withProvince = exportData.filter(r => r.province).length;
        const withObservations = exportData.filter(r => r.additional).length;
        
        console.log(`Records with center name: ${withCenter}/${allExtractedData.length}`);
        console.log(`Records with locality: ${withLocality}/${allExtractedData.length}`);
        console.log(`Records with province: ${withProvince}/${allExtractedData.length}`);
        console.log(`Records with observations: ${withObservations}/${allExtractedData.length}`);
        
        // Find potential duplicates
        const centerCounts = {};
        exportData.forEach(record => {
            if (record.center) {
                const key = record.center.toLowerCase();
                centerCounts[key] = (centerCounts[key] || 0) + 1;
            }
        });
        
        const duplicates = Object.entries(centerCounts)
            .filter(([center, count]) => count > 1)
            .map(([center, count]) => ({ center, count }));
        
        if (duplicates.length > 0) {
            console.log(`\n⚠️  Potential duplicates found: ${duplicates.length}`);
            duplicates.forEach(dup => {
                console.log(`  "${dup.center}": ${dup.count} times`);
            });
        } else {
            console.log("\n✅ No duplicate center names found");
        }
        
        return {
            success: true,
            totalRecords: allExtractedData.length,
            outputFile: outputPath,
            duplicates: duplicates.length
        };
        
    } catch (error) {
        console.error("❌ Processing failed:", error.message);
        return { success: false, error: error.message };
    }
}

// =====================================================================
// RUN THE SCRIPT
// =====================================================================

console.log("Starting Excel processing...");
console.log("Make sure spread1.xlsx is in the same folder as this script!\n");

const result = processspread1();

if (result.success) {
    console.log("\n🎉 SUCCESS! Your corrected data is ready.");
    console.log("Open the generated 'spread1_corrected.xlsx' file to review the results.");
} else {
    console.log("\n💥 FAILED! Check the error message above.");
}