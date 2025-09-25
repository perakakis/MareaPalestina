// detect-duplicates-main.js
// Script to detect and handle duplicates in the main Google Sheets database
// Adapted from merge-datasets.js for single dataset self-comparison

const XLSX = require('xlsx');
const _ = require('lodash');
const fs = require('fs');
const path = require('path');

// =====================================================================
// CONFIGURATION
// =====================================================================

let CONFIG = {
    inputFile: 'main_database.csv',
    outputFile: 'main_database_duplicates_analysis.xlsx',
    cleanedFile: 'main_database_cleaned.csv',

    // Similarity thresholds for duplicate detection
    thresholds: {
        centerName: 0.85,      // 85% similarity for center names
        location: 0.80,        // 80% similarity for location matching
        email: 0.95,           // 95% similarity for email matching
        representative: 0.90   // 90% similarity for representative names
    },

    // Duplicate handling strategy
    strategy: 'review', // Options: 'review', 'remove_oldest', 'remove_newest', 'merge'

    // Fields to compare for duplicates
    compareFields: ['center', 'email', 'representative', 'locality', 'province', 'region'],

    // Priority order for keeping records (higher priority = kept when duplicate found)
    priorityOrder: ['date', 'email', 'representative', 'commitments', 'additional']
};

// Expected column structure from Google Sheets
const EXPECTED_COLUMNS = [
    'representative', 'center', 'email', 'department',
    'locality', 'province', 'region', 'commitments',
    'additional', 'date'
];

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

// Normalize email for comparison
function normalizeEmail(email) {
    if (!email) return '';
    return email.toLowerCase().trim();
}

// Calculate record completeness score (higher is better)
function calculateCompletenessScore(record) {
    let score = 0;
    const weights = {
        representative: 1,
        center: 2,
        email: 3,
        department: 1,
        locality: 1,
        province: 1,
        region: 1,
        commitments: 2,
        additional: 1,
        date: 1
    };

    Object.entries(weights).forEach(([field, weight]) => {
        if (record[field] && typeof record[field] === 'string' && record[field].trim()) {
            score += weight;
        }
    });

    return score;
}

// Parse date for comparison
function parseDate(dateStr) {
    if (!dateStr) return new Date(0);

    // Convert to string if it's not already
    const dateString = typeof dateStr === 'string' ? dateStr : String(dateStr);

    // Handle various date formats
    const formats = [
        /(\d{1,2})\/(\d{1,2})\/(\d{4})/,  // MM/DD/YYYY or DD/MM/YYYY
        /(\d{4})-(\d{1,2})-(\d{1,2})/,    // YYYY-MM-DD
        /(\d{1,2})-(\d{1,2})-(\d{4})/     // DD-MM-YYYY or MM-DD-YYYY
    ];

    for (let format of formats) {
        const match = dateString.match(format);
        if (match) {
            return new Date(match[3] || match[1], (match[1] || match[2]) - 1, match[2] || match[3]);
        }
    }

    return new Date(dateString);
}

// =====================================================================
// DATA LOADING FUNCTIONS
// =====================================================================

function loadMainDatabase() {
    console.log(`Loading main database from: ${CONFIG.inputFile}`);

    const filePath = path.join(__dirname, CONFIG.inputFile);
    if (!fs.existsSync(filePath)) {
        throw new Error(`${CONFIG.inputFile} not found! Please export your Google Sheets data as CSV first.`);
    }

    let data;
    const extension = path.extname(CONFIG.inputFile).toLowerCase();

    if (extension === '.csv') {
        // Read CSV file using xlsx library with proper UTF-8 encoding
        const fileBuffer = fs.readFileSync(filePath);
        const workbook = XLSX.read(fileBuffer, {
            type: 'buffer',
            codepage: 65001, // UTF-8 encoding
            cellText: true
        });
        const sheetName = workbook.SheetNames[0];
        data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        data.forEach((record, index) => {
            record._originalIndex = index;
        });
    } else if (extension === '.xlsx') {
        // Read Excel file
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        data.forEach((record, index) => {
            record._originalIndex = index;
        });
    } else {
        throw new Error(`Unsupported file format: ${extension}. Please use CSV or XLSX.`);
    }

    console.log(`  ✓ Loaded ${data.length} records from main database`);

    // Validate expected columns
    const missingColumns = EXPECTED_COLUMNS.filter(col =>
        !Object.keys(data[0] || {}).includes(col)
    );

    if (missingColumns.length > 0) {
        console.warn(`  ⚠️  Missing expected columns: ${missingColumns.join(', ')}`);
    }

    return data;
}

// =====================================================================
// DUPLICATE DETECTION FUNCTIONS
// =====================================================================

function findDuplicatesInDataset(data) {
    console.log("\n=== DUPLICATE DETECTION ===");

    const duplicateGroups = [];
    const processed = new Set();

    console.log("Comparing records for duplicates...");

    for (let i = 0; i < data.length - 1; i++) {
        if (processed.has(i)) continue;

        const record1 = data[i];
        const duplicates = [{ record: record1, index: i }];

        for (let j = i + 1; j < data.length; j++) {
            if (processed.has(j)) continue;

            const record2 = data[j];

            if (areRecordsDuplicate(record1, record2)) {
                duplicates.push({ record: record2, index: j });
                processed.add(j);
            }
        }

        if (duplicates.length > 1) {
            duplicateGroups.push({
                groupId: duplicateGroups.length + 1,
                records: duplicates,
                similarities: calculateGroupSimilarities(duplicates)
            });

            processed.add(i);
            console.log(`  Found duplicate group ${duplicateGroups.length}: ${duplicates.length} similar records`);
            duplicates.forEach(dup => {
                console.log(`    - "${dup.record.center}" (${dup.record.locality}, ${dup.record.province})`);
            });
        }
    }

    console.log(`\n✓ Found ${duplicateGroups.length} duplicate groups with ${duplicateGroups.reduce((sum, group) => sum + group.records.length, 0)} total records`);
    return duplicateGroups;
}

function areRecordsDuplicate(record1, record2) {
    // Multiple criteria for duplicate detection

    // 1. Exact email match (if both have emails)
    if (record1.email && record2.email && typeof record1.email === 'string' && typeof record2.email === 'string' && record1.email.trim() && record2.email.trim()) {
        const emailSimilarity = calculateSimilarity(
            normalizeEmail(record1.email),
            normalizeEmail(record2.email)
        );
        if (emailSimilarity >= CONFIG.thresholds.email) {
            return true;
        }
    }

    // 2. Center name + location similarity
    const centerSimilarity = calculateSimilarity(
        normalizeCenterName(record1.center),
        normalizeCenterName(record2.center)
    );

    const locationSimilarity = calculateSimilarity(
        createLocationKey(record1),
        createLocationKey(record2)
    );

    // High center name similarity
    if (centerSimilarity >= CONFIG.thresholds.centerName) {
        return true;
    }

    // Moderate center name + location match
    if (centerSimilarity >= 0.70 && locationSimilarity >= CONFIG.thresholds.location) {
        return true;
    }

    // 3. Representative name + location similarity (for same person, different entries)
    if (record1.representative && record2.representative && typeof record1.representative === 'string' && typeof record2.representative === 'string') {
        const repSimilarity = calculateSimilarity(
            record1.representative.toLowerCase().trim(),
            record2.representative.toLowerCase().trim()
        );

        if (repSimilarity >= CONFIG.thresholds.representative &&
            locationSimilarity >= 0.60) {
            return true;
        }
    }

    return false;
}

function calculateGroupSimilarities(duplicates) {
    const similarities = [];

    for (let i = 0; i < duplicates.length; i++) {
        for (let j = i + 1; j < duplicates.length; j++) {
            const record1 = duplicates[i].record;
            const record2 = duplicates[j].record;

            similarities.push({
                indices: [duplicates[i].index, duplicates[j].index],
                centerSimilarity: calculateSimilarity(
                    normalizeCenterName(record1.center),
                    normalizeCenterName(record2.center)
                ),
                locationSimilarity: calculateSimilarity(
                    createLocationKey(record1),
                    createLocationKey(record2)
                ),
                emailSimilarity: record1.email && record2.email ?
                    calculateSimilarity(normalizeEmail(record1.email), normalizeEmail(record2.email)) : 0,
                representativeSimilarity: record1.representative && record2.representative ?
                    calculateSimilarity(record1.representative.toLowerCase(), record2.representative.toLowerCase()) : 0
            });
        }
    }

    return similarities;
}

// =====================================================================
// DUPLICATE HANDLING FUNCTIONS
// =====================================================================

function processDuplicates(data, duplicateGroups) {
    console.log("\n=== PROCESSING DUPLICATES ===");

    let processedData = [...data];
    let actions = [];

    let result;
    switch (CONFIG.strategy) {
        case 'remove_oldest':
            result = removeOldestDuplicates(processedData, duplicateGroups);
            processedData = result.processedData;
            actions = result.actions;
            break;
        case 'remove_newest':
            result = removeNewestDuplicates(processedData, duplicateGroups);
            processedData = result.processedData;
            actions = result.actions;
            break;
        case 'merge':
            result = mergeDuplicates(processedData, duplicateGroups);
            processedData = result.processedData;
            actions = result.actions;
            break;
        case 'review':
        default:
            result = markDuplicatesForReview(processedData, duplicateGroups);
            processedData = result.processedData;
            actions = result.actions;
            break;
    }

    console.log(`✓ Processed ${duplicateGroups.length} duplicate groups`);
    console.log(`✓ Applied ${actions.length} actions`);

    return { processedData, actions };
}

function removeOldestDuplicates(data, duplicateGroups) {
    const processedData = [...data];
    const actions = [];
    const indicesToRemove = new Set();

    duplicateGroups.forEach(group => {
        // Sort by date (newest first)
        const sortedRecords = group.records.sort((a, b) => {
            const dateA = parseDate(a.record.date);
            const dateB = parseDate(b.record.date);
            return dateB - dateA; // Newest first
        });

        // Keep the newest, mark others for removal
        for (let i = 1; i < sortedRecords.length; i++) {
            const recordToRemove = sortedRecords[i];
            indicesToRemove.add(recordToRemove.index);

            actions.push({
                action: 'remove',
                reason: 'older_duplicate',
                groupId: group.groupId,
                removedIndex: recordToRemove.index,
                removedRecord: recordToRemove.record,
                keptRecord: sortedRecords[0].record
            });
        }
    });

    // Remove duplicates from data
    const finalData = processedData.filter((_, index) => !indicesToRemove.has(index));

    console.log(`  Removed ${indicesToRemove.size} older duplicate records`);
    return { processedData: finalData, actions };
}

function removeNewestDuplicates(data, duplicateGroups) {
    const processedData = [...data];
    const actions = [];
    const indicesToRemove = new Set();

    duplicateGroups.forEach(group => {
        // Sort by date (oldest first)
        const sortedRecords = group.records.sort((a, b) => {
            const dateA = parseDate(a.record.date);
            const dateB = parseDate(b.record.date);
            return dateA - dateB; // Oldest first
        });

        // Keep the oldest, mark others for removal
        for (let i = 1; i < sortedRecords.length; i++) {
            const recordToRemove = sortedRecords[i];
            indicesToRemove.add(recordToRemove.index);

            actions.push({
                action: 'remove',
                reason: 'newer_duplicate',
                groupId: group.groupId,
                removedIndex: recordToRemove.index,
                removedRecord: recordToRemove.record,
                keptRecord: sortedRecords[0].record
            });
        }
    });

    // Remove duplicates from data
    const finalData = processedData.filter((_, index) => !indicesToRemove.has(index));

    console.log(`  Removed ${indicesToRemove.size} newer duplicate records`);
    return { processedData: finalData, actions };
}

function mergeDuplicates(data, duplicateGroups) {
    const processedData = [...data];
    const actions = [];
    const indicesToRemove = new Set();

    duplicateGroups.forEach(group => {
        // Sort by completeness score and date
        const sortedRecords = group.records.sort((a, b) => {
            const scoreA = calculateCompletenessScore(a.record);
            const scoreB = calculateCompletenessScore(b.record);
            if (scoreB !== scoreA) return scoreB - scoreA; // Higher score first

            const dateA = parseDate(a.record.date);
            const dateB = parseDate(b.record.date);
            return dateB - dateA; // Newer first if same score
        });

        const baseRecord = sortedRecords[0];
        const mergedRecord = { ...baseRecord.record };

        // Merge information from other records
        for (let i = 1; i < sortedRecords.length; i++) {
            const recordToMerge = sortedRecords[i].record;

            // Fill in missing fields
            Object.keys(recordToMerge).forEach(field => {
                if (!mergedRecord[field] || (typeof mergedRecord[field] === 'string' && !mergedRecord[field].trim())) {
                    if (recordToMerge[field] && typeof recordToMerge[field] === 'string' && recordToMerge[field].trim()) {
                        mergedRecord[field] = recordToMerge[field];
                    }
                }
            });

            // Combine commitments
            if (recordToMerge.commitments && typeof recordToMerge.commitments === 'string' && mergedRecord.commitments !== recordToMerge.commitments) {
                const existingCommitments = new Set((typeof mergedRecord.commitments === 'string' ? mergedRecord.commitments : '').split(',').map(s => s.trim()));
                const newCommitments = recordToMerge.commitments.split(',').map(s => s.trim());

                newCommitments.forEach(commitment => existingCommitments.add(commitment));
                mergedRecord.commitments = Array.from(existingCommitments).join(', ');
            }

            // Combine additional comments
            if (recordToMerge.additional && mergedRecord.additional !== recordToMerge.additional) {
                if (!mergedRecord.additional) {
                    mergedRecord.additional = recordToMerge.additional;
                } else {
                    mergedRecord.additional += ' | ' + recordToMerge.additional;
                }
            }

            indicesToRemove.add(sortedRecords[i].index);
        }

        // Update the base record with merged data
        processedData[baseRecord.index] = mergedRecord;

        actions.push({
            action: 'merge',
            reason: 'duplicate_merge',
            groupId: group.groupId,
            baseIndex: baseRecord.index,
            mergedIndices: sortedRecords.slice(1).map(r => r.index),
            mergedRecord: mergedRecord
        });
    });

    // Remove merged duplicates
    const finalData = processedData.filter((_, index) => !indicesToRemove.has(index));

    console.log(`  Merged ${duplicateGroups.length} duplicate groups, removed ${indicesToRemove.size} records`);
    return { processedData: finalData, actions };
}

function markDuplicatesForReview(data, duplicateGroups) {
    const processedData = data.map(record => ({ ...record }));
    const actions = [];

    // Add duplicate flags to all records in duplicate groups
    duplicateGroups.forEach(group => {
        group.records.forEach(({ record, index }) => {
            processedData[index].duplicate_flag = `DUPLICATE_GROUP_${group.groupId}`;
            processedData[index].duplicate_count = group.records.length;
            processedData[index].completeness_score = calculateCompletenessScore(record);

            actions.push({
                action: 'mark',
                reason: 'duplicate_review',
                groupId: group.groupId,
                index: index,
                record: record
            });
        });
    });

    console.log(`  Marked ${actions.length} records for manual review`);
    return { processedData, actions };
}

// =====================================================================
// EXPORT FUNCTIONS
// =====================================================================

function exportResults(originalData, processedData, duplicateGroups, actions) {
    console.log("\n=== EXPORTING RESULTS ===");

    const workbook = XLSX.utils.book_new();

    // 1. Processed dataset
    const processedSheet = XLSX.utils.json_to_sheet(processedData.map(record => {
        const clean = {};
        EXPECTED_COLUMNS.forEach(col => {
            clean[col] = record[col] || '';
        });

        // Add duplicate analysis columns if in review mode
        if (CONFIG.strategy === 'review') {
            clean.duplicate_flag = record.duplicate_flag || '';
            clean.duplicate_count = record.duplicate_count || '';
            clean.completeness_score = record.completeness_score || '';
        }

        return clean;
    }));
    XLSX.utils.book_append_sheet(workbook, processedSheet, "Processed_Data");

    // 2. Duplicate groups analysis
    const duplicateAnalysis = [];
    duplicateGroups.forEach(group => {
        group.records.forEach((record, idx) => {
            duplicateAnalysis.push({
                group_id: group.groupId,
                record_number: idx + 1,
                total_in_group: group.records.length,
                center: record.record.center,
                representative: record.record.representative,
                email: record.record.email,
                locality: record.record.locality,
                province: record.record.province,
                region: record.record.region,
                date: record.record.date,
                original_index: record.index,
                completeness_score: calculateCompletenessScore(record.record)
            });
        });
    });

    const duplicatesSheet = XLSX.utils.json_to_sheet(duplicateAnalysis);
    XLSX.utils.book_append_sheet(workbook, duplicatesSheet, "Duplicate_Groups");

    // 3. Actions taken
    const actionsSheet = XLSX.utils.json_to_sheet(actions.map(action => ({
        group_id: action.groupId,
        action_type: action.action,
        reason: action.reason,
        affected_index: action.index || action.removedIndex || action.baseIndex,
        details: action.action === 'merge' ? `Merged ${action.mergedIndices.join(', ')} into ${action.baseIndex}` :
                action.action === 'remove' ? `Removed ${action.reason}` :
                `Marked for ${action.reason}`
    })));
    XLSX.utils.book_append_sheet(workbook, actionsSheet, "Actions_Taken");

    // 4. Statistics
    const statistics = [
        { metric: 'Original Records', value: originalData.length },
        { metric: 'Processed Records', value: processedData.length },
        { metric: 'Duplicate Groups Found', value: duplicateGroups.length },
        { metric: 'Total Duplicates', value: duplicateGroups.reduce((sum, g) => sum + g.records.length, 0) },
        { metric: 'Records Removed/Merged', value: originalData.length - processedData.length },
        { metric: 'Strategy Used', value: CONFIG.strategy },
        { metric: '', value: '' },
        { metric: 'Thresholds:', value: '' },
        { metric: 'Center Name', value: `${CONFIG.thresholds.centerName * 100}%` },
        { metric: 'Location', value: `${CONFIG.thresholds.location * 100}%` },
        { metric: 'Email', value: `${CONFIG.thresholds.email * 100}%` },
        { metric: 'Representative', value: `${CONFIG.thresholds.representative * 100}%` }
    ];

    const statsSheet = XLSX.utils.json_to_sheet(statistics);
    XLSX.utils.book_append_sheet(workbook, statsSheet, "Statistics");

    // Write analysis file
    const analysisPath = path.join(__dirname, CONFIG.outputFile);
    XLSX.writeFile(workbook, analysisPath);
    console.log(`✅ Analysis exported to: ${analysisPath}`);

    // Export cleaned CSV if not in review mode
    if (CONFIG.strategy !== 'review') {
        const cleanedCsvPath = path.join(__dirname, CONFIG.cleanedFile);
        const csvContent = [
            EXPECTED_COLUMNS.join(','),
            ...processedData.map(record =>
                EXPECTED_COLUMNS.map(col => `"${String(record[col] || '').replace(/"/g, '""')}"`).join(',')
            )
        ].join('\n');

        fs.writeFileSync(cleanedCsvPath, '\uFEFF' + csvContent, 'utf-8'); // Add BOM for proper UTF-8
        console.log(`✅ Cleaned dataset exported to: ${cleanedCsvPath}`);
    }

    return { analysisPath, cleanedPath: CONFIG.strategy !== 'review' ? path.join(__dirname, CONFIG.cleanedFile) : null };
}

// =====================================================================
// MAIN EXECUTION
// =====================================================================

function main() {
    try {
        console.log("=== MAIN DATABASE DUPLICATE DETECTION ===");
        console.log(`Input file: ${CONFIG.inputFile}`);
        console.log(`Strategy: ${CONFIG.strategy}`);
        console.log(`Similarity thresholds: Center=${CONFIG.thresholds.centerName * 100}%, Location=${CONFIG.thresholds.location * 100}%\n`);

        // Load main database
        const originalData = loadMainDatabase();

        // Find duplicates
        const duplicateGroups = findDuplicatesInDataset(originalData);

        if (duplicateGroups.length === 0) {
            console.log("\n🎉 No duplicates found! Your database is clean.");
            return { success: true, duplicatesFound: 0 };
        }

        // Process duplicates according to strategy
        const { processedData, actions } = processDuplicates(originalData, duplicateGroups);

        // Export results
        const outputPaths = exportResults(originalData, processedData, duplicateGroups, actions);

        // Final summary
        console.log("\n🎉 DUPLICATE DETECTION COMPLETED!");
        console.log(`📊 Found ${duplicateGroups.length} duplicate groups with ${duplicateGroups.reduce((s, g) => s + g.records.length, 0)} total records`);
        console.log(`📁 Analysis file: ${CONFIG.outputFile}`);

        if (outputPaths.cleanedPath) {
            console.log(`📁 Cleaned dataset: ${CONFIG.cleanedFile}`);
            console.log(`💡 You can now replace your Google Sheets content with the cleaned CSV file`);
        } else {
            console.log(`💡 Review the marked duplicates in the processed data and decide how to handle them`);
        }

        return {
            success: true,
            duplicatesFound: duplicateGroups.length,
            totalDuplicateRecords: duplicateGroups.reduce((s, g) => s + g.records.length, 0),
            recordsProcessed: processedData.length,
            originalRecords: originalData.length,
            outputPaths
        };

    } catch (error) {
        console.error("❌ Duplicate detection failed:", error.message);
        return { success: false, error: error.message };
    }
}

// =====================================================================
// CLI INTERFACE
// =====================================================================

// Parse command line arguments
const args = process.argv.slice(2);
const argMap = {};

for (let i = 0; i < args.length; i += 2) {
    if (args[i].startsWith('--')) {
        const key = args[i].slice(2);
        const value = args[i + 1];
        argMap[key] = value;
    }
}

// Apply command line overrides
if (argMap.input) CONFIG.inputFile = argMap.input;
if (argMap.strategy) CONFIG.strategy = argMap.strategy;
if (argMap.threshold) CONFIG.thresholds.centerName = parseFloat(argMap.threshold);

// Display usage information
if (args.includes('--help') || args.includes('-h')) {
    console.log(`
=== Main Database Duplicate Detection Tool ===

Usage: node detect-duplicates-main.js [options]

Options:
  --input <file>      Input CSV/XLSX file (default: ${CONFIG.inputFile})
  --strategy <type>   Duplicate handling strategy (default: ${CONFIG.strategy})
                      Options: review, remove_oldest, remove_newest, merge
  --threshold <num>   Center name similarity threshold 0-1 (default: ${CONFIG.thresholds.centerName})
  --help, -h         Show this help message

Strategies:
  review             Mark duplicates for manual review (recommended)
  remove_oldest      Automatically remove older duplicate records
  remove_newest      Automatically remove newer duplicate records
  merge              Merge duplicate records into single entries

Examples:
  node detect-duplicates-main.js
  node detect-duplicates-main.js --input my_export.csv --strategy review
  node detect-duplicates-main.js --strategy remove_oldest --threshold 0.8
`);
    process.exit(0);
}

// Run the main function
console.log("Starting duplicate detection process...");
console.log(`Make sure ${CONFIG.inputFile} is in this folder!\n`);

const result = main();

if (result.success) {
    console.log("\n✨ Duplicate detection completed successfully!");
    if (result.duplicatesFound === 0) {
        console.log("🎉 Your database is already clean - no duplicates found!");
    } else {
        console.log(`📋 Review the analysis file to see ${result.duplicatesFound} duplicate groups found.`);
    }
} else {
    console.log(`\n💥 Duplicate detection failed: ${result.error}`);
    process.exit(1);
}