/**
 * Language breakdown in analysis.
 */
export interface LanguageBreakdown {
  language: string;
  extension: string;
  fileCount: number;
  percentage: number;
}

/**
 * Result of codebase structure analysis.
 */
export interface StructureAnalysis {
  root: string;
  name: string;
  languages: LanguageBreakdown[];
  sourceDirectories: string[];
  entryPoints: string[];
  stats: {
    directories: number;
    files: number;
    lines: number;
  };
}

/**
 * Export information from code analysis.
 */
export interface ExportInfo {
  name: string;
  type: 'function' | 'class' | 'const' | 'type' | 'interface';
  file: string;
}

/**
 * Detected pattern information.
 */
export interface PatternInfo {
  pattern: string;
  confidence: number;
  evidence: string[];
}

/**
 * Deep analysis result including exports and patterns.
 */
export interface DeepAnalysis extends StructureAnalysis {
  exports: ExportInfo[];
  patterns: PatternInfo[];
}
