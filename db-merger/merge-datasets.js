// merge-datasets.js
// Phase 2: Merge corrected spread1 with spread2 and detect duplicates

const XLSX = require('xlsx');
const _ = require('lodash');
const fs = require('fs');
const path = require('path');

// =====================================================================
// CONFIGURATION
// =====================================================================

const INPUT_FILES = {
    spread1_corrected: 'spread1_corrected.xlsx',
    spread2_corrected: 'spread2_corrected.xlsx'  // Now using corrected version
};

const OUTPUT_FILE = 'final_merged_dataset.xlsx';

// Similarity thresholds for duplicate detection
const SIMILARITY_THRESHOLDS = {
    centerName: 0.85,      // 85% similarity for center names
    location: 0.80         // 80% similarity for location matching
};

// =====================================================================
// UTILITY FUNCTIONS
// =====================================================================

// Calculate string similarity using Levenshtein distance
function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    str1 = str1.toLowerCase().trim();
    str2 = str2.toLowerCase().trim();
    
    if (str1 === str2) return 1;
    
    const len1 = str1.length;
    const len2 = str2.length;
    
    if (len1 === 0) return len2 === 0 ? 1 : 0;
    if (len2 === 0) return 0;
    
    const matrix = Array(len1 + 1).fill().map(() => Array(len2 + 1).fill(0));
    
    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;
    
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // deletion
                matrix[i][j - 1] + 1,      // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );
        }
    }
    
    const maxLen = Math.max(len1, len2);
    return (maxLen - matrix[len1][len2]) / maxLen;
}

// Normalize center names for better matching
function normalizeCenterName(name) {
    if (!name) return '';
    return name.toLowerCase()
               .replace(/\b(ies|ceip|cep|cee|ieso|cifp|cpifp|cea)\b/g, '') // Remove school type abbreviations
               .replace(/\b(instituto|colegio|centro|escuela)\b/g, '')      // Remove institution words
               .replace(/[^\w\s]/g, ' ')                                    // Remove punctuation
               .replace(/\s+/g, ' ')                                        // Normalize spaces
               .trim();
}

// Create location string for matching
function createLocationKey(record) {
    const parts = [
        record.locality || '',
        record.province || '',
        record.region || ''
    ].filter(part => part.trim());
    
    return parts.join(' | ').toLowerCase();
}

// =====================================================================
// DATA LOADING FUNCTIONS
// =====================================================================

function loadSpread1Data() {
    console.log("Loading corrected spread1 data...");
    
    const filePath = path.join(__dirname, INPUT_FILES.spread1_corrected);
    if (!fs.existsSync(filePath)) {
        throw new Error(`${INPUT_FILES.spread1_corrected} not found! Run the spread1 correction script first.`);
    }
    
    const workbook = XLSX.readFile(filePath);
    const data = XLSX.utils.sheet_to_json(workbook.Sheets['Corrected_Data']);
    
    console.log(`  ✓ Loaded ${data.length} records from spread1`);
    return data.map((record, index) => ({
        ...record,
        _source: 'spread1',
        _index: index
    }));
}

function loadSpread2Data() {
    console.log("Loading corrected spread2 data...");
    
    const filePath = path.join(__dirname, INPUT_FILES.spread2_corrected);
    if (!fs.existsSync(filePath)) {
        throw new Error(`${INPUT_FILES.spread2_corrected} not found! Run the spread2 standardization script first.`);
    }
    
    const workbook = XLSX.readFile(filePath);
    const sheetName = 'Corrected_Data'; // Updated to use corrected sheet
    const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    
    // Convert to consistent format (spread2 has different column names)
    const data = rawData.map((record, index) => ({
        representative: record.representative || '',
        center: record.center || '',
        email: record.email || '',
        department: record.department || '',
        locality: record.locality || '',
        province: record.province || '',
        region: record.region || '',
        commitments: record.commitments || '',
        additional: record.additional || '',
        date: record.date || '',
        _source: 'spread2',
        _index: index
    }));
    
    console.log(`  ✓ Loaded ${data.length} records from spread2`);
    return data;
}

// =====================================================================
// DUPLICATE DETECTION FUNCTIONS
// =====================================================================

function findDuplicates(spread1Data, spread2Data) {
    console.log("\n=== DUPLICATE DETECTION ===");
    
    const duplicates = [];
    const processed = new Set();
    
    console.log("Comparing spread1 records against spread2...");
    
    for (let i = 0; i < spread1Data.length; i++) {
        const record1 = spread1Data[i];
        const normalizedName1 = normalizeCenterName(record1.center);
        const location1 = createLocationKey(record1);
        
        if (processed.has(i)) continue;
        
        for (let j = 0; j < spread2Data.length; j++) {
            const record2 = spread2Data[j];
            const normalizedName2 = normalizeCenterName(record2.center);
            const location2 = createLocationKey(record2);
            
            // Calculate similarities
            const nameSimilarity = calculateSimilarity(normalizedName1, normalizedName2);
            const locationSimilarity = calculateSimilarity(location1, location2);
            
            // Check if it's a potential duplicate
            const isNameMatch = nameSimilarity >= SIMILARITY_THRESHOLDS.centerName;
            const isLocationMatch = locationSimilarity >= SIMILARITY_THRESHOLDS.location;
            
            // Consider it a duplicate if:
            // 1. High name similarity, OR
            // 2. Moderate name similarity + location match
            const isDuplicate = isNameMatch || 
                               (nameSimilarity >= 0.70 && isLocationMatch);
            
            if (isDuplicate) {
                duplicates.push({
                    spread1_record: record1,
                    spread2_record: record2,
                    spread1_index: i,
                    spread2_index: j,
                    name_similarity: nameSimilarity,
                    location_similarity: locationSimilarity,
                    match_reason: isNameMatch ? 'name_match' : 'name_location_match'
                });
                
                processed.add(i);
                console.log(`  Found duplicate: "${record1.center}" ≈ "${record2.center}" (${(nameSimilarity * 100).toFixed(1)}% similar)`);
                break; // Move to next spread1 record
            }
        }
    }
    
    console.log(`\n✓ Found ${duplicates.length} potential duplicates`);
    return duplicates;
}

// =====================================================================
// MERGING FUNCTIONS
// =====================================================================

function mergeDatasets(spread1Data, spread2Data, duplicates) {
    console.log("\n=== MERGING DATASETS ===");
    
    // Get indices of spread1 records that are duplicates
    const duplicateIndices = new Set(duplicates.map(dup => dup.spread1_index));
    
    // Start with all spread2 data (higher priority)
    const mergedData = [...spread2Data];
    
    // Add non-duplicate records from spread1
    const uniqueSpread1Records = spread1Data.filter((record, index) => 
        !duplicateIndices.has(index)
    );
    
    mergedData.push(...uniqueSpread1Records);
    
    console.log(`✓ Merged dataset contains:`);
    console.log(`  • ${spread2Data.length} records from spread2 (kept all)`);
    console.log(`  • ${uniqueSpread1Records.length} unique records from spread1`);
    console.log(`  • ${duplicates.length} duplicates removed from spread1`);
    console.log(`  • Total: ${mergedData.length} records`);
    
    return mergedData;
}

// =====================================================================
// EXPORT FUNCTIONS
// =====================================================================

function exportResults(mergedData, duplicates, spread1Data, spread2Data) {
    console.log("\n=== EXPORTING RESULTS ===");
    
    const workbook = XLSX.utils.book_new();
    
    // 1. Final merged dataset (clean - no metadata)
    const cleanMergedData = mergedData.map(record => {
        const clean = {};
        ['representative', 'center', 'email', 'department', 'locality', 
         'province', 'region', 'commitments', 'additional', 'date'].forEach(col => {
            clean[col] = record[col] || '';
        });
        return clean;
    });
    
    const mergedSheet = XLSX.utils.json_to_sheet(cleanMergedData);
    XLSX.utils.book_append_sheet(workbook, mergedSheet, "Final_Dataset");
    
    // 2. Duplicate analysis sheet
    const duplicateAnalysis = duplicates.map(dup => ({
        action: 'REMOVED (kept spread2)',
        spread1_center: dup.spread1_record.center,
        spread1_locality: dup.spread1_record.locality,
        spread1_province: dup.spread1_record.province,
        spread1_region: dup.spread1_record.region,
        spread2_center: dup.spread2_record.center,
        spread2_locality: dup.spread2_record.locality,
        spread2_province: dup.spread2_record.province,
        spread2_region: dup.spread2_record.region,
        name_similarity_percent: Math.round(dup.name_similarity * 100),
        location_similarity_percent: Math.round(dup.location_similarity * 100),
        match_reason: dup.match_reason
    }));
    
    const duplicatesSheet = XLSX.utils.json_to_sheet(duplicateAnalysis);
    XLSX.utils.book_append_sheet(workbook, duplicatesSheet, "Duplicates_Found");
    
    // 3. Merge statistics
    const bySource = _.groupBy(mergedData, '_source');
    const byRegion = _.groupBy(cleanMergedData, 'region');
    
    const statistics = [
        { metric: 'Total Final Records', value: mergedData.length },
        { metric: 'From spread2 (original)', value: bySource.spread2?.length || 0 },
        { metric: 'From spread1 (unique)', value: bySource.spread1?.length || 0 },
        { metric: 'Duplicates Removed', value: duplicates.length },
        { metric: 'Records with Email', value: cleanMergedData.filter(r => r.email).length },
        { metric: 'Records with Representative', value: cleanMergedData.filter(r => r.representative).length },
        { metric: 'Records with Locality', value: cleanMergedData.filter(r => r.locality).length },
        { metric: 'Records with Province', value: cleanMergedData.filter(r => r.province).length },
        { metric: '', value: '' }, // Empty row
        { metric: 'BY REGION:', value: '' }
    ];
    
    Object.entries(byRegion)
        .sort(([,a], [,b]) => b.length - a.length)
        .forEach(([region, records]) => {
            statistics.push({ metric: region, value: records.length });
        });
    
    const statsSheet = XLSX.utils.json_to_sheet(statistics);
    XLSX.utils.book_append_sheet(workbook, statsSheet, "Statistics");
    
    // 4. Processing log
    const processingLog = [
        { step: 1, action: 'Load spread1 (corrected)', records: spread1Data.length, notes: 'From previous processing' },
        { step: 2, action: 'Load spread2 (original)', records: spread2Data.length, notes: 'Higher quality data' },
        { step: 3, action: 'Detect duplicates', records: duplicates.length, notes: `Name similarity ≥${SIMILARITY_THRESHOLDS.centerName * 100}%` },
        { step: 4, action: 'Remove duplicates from spread1', records: duplicates.length, notes: 'Kept spread2 versions' },
        { step: 5, action: 'Final merged dataset', records: mergedData.length, notes: 'Ready for use' }
    ];
    
    const logSheet = XLSX.utils.json_to_sheet(processingLog);
    XLSX.utils.book_append_sheet(workbook, logSheet, "Processing_Log");
    
    // Write file
    const outputPath = path.join(__dirname, OUTPUT_FILE);
    XLSX.writeFile(workbook, outputPath);
    
    console.log(`✅ Results exported to: ${outputPath}`);
    return outputPath;
}

// =====================================================================
// MAIN EXECUTION
// =====================================================================

function main() {
    try {
        console.log("=== PHASE 2: MERGING AND DUPLICATE DETECTION ===");
        console.log("Starting merge process...\n");
        
        // Load both datasets
        const spread1Data = loadSpread1Data();
        const spread2Data = loadSpread2Data();
        
        // Find duplicates
        const duplicates = findDuplicates(spread1Data, spread2Data);
        
        // Merge datasets (keeping spread2 for duplicates)
        const mergedData = mergeDatasets(spread1Data, spread2Data, duplicates);
        
        // Export results
        const outputPath = exportResults(mergedData, duplicates, spread1Data, spread2Data);
        
        // Final summary
        console.log("\n🎉 MERGE COMPLETED SUCCESSFULLY!");
        console.log(`📁 Final dataset: ${OUTPUT_FILE}`);
        console.log(`📊 Total records: ${mergedData.length}`);
        console.log(`🔍 Duplicates found and removed: ${duplicates.length}`);
        console.log(`📈 Data quality: ${Math.round((mergedData.filter(r => r.email).length / mergedData.length) * 100)}% have email addresses`);
        
        if (duplicates.length > 0) {
            console.log("\n📋 Check the 'Duplicates_Found' sheet to review removed duplicates.");
        }
        
        return {
            success: true,
            totalRecords: mergedData.length,
            duplicatesRemoved: duplicates.length,
            outputFile: outputPath
        };
        
    } catch (error) {
        console.error("❌ Merge failed:", error.message);
        return { success: false, error: error.message };
    }
}

// Run the merge
console.log("Starting Phase 2 merge process...");
console.log("Make sure both spread1_corrected.xlsx and spread2_corrected.xlsx are in this folder!\n");

const result = main();

if (result.success) {
    console.log("\n✨ Phase 2 completed! Your final merged dataset is ready for use.");
} else {
    console.log("\n💥 Phase 2 failed! Check the error message above.");
}