import { ParsedNode, TranslationResult } from '../types';
import { 
  getNodeExplanation, 
  detectPerformanceIssues, 
  generateRecommendations,
  ExecutionStep,
  formatNumber
} from './explanations';

export class PostgreSQLTranslator {
  translate(rootNode: ParsedNode): TranslationResult {
    const steps = this.generateExecutionSteps(rootNode);
    const allWarnings = this.collectAllWarnings(rootNode);
    const allRecommendations = this.collectAllRecommendations(rootNode);
    const summary = this.generateDetailedSummary(rootNode, steps);

    return {
      summary,
      steps: steps.map(step => this.formatDetailedStep(step)),
      warnings: allWarnings,
      recommendations: allRecommendations
    };
  }

  private generateExecutionSteps(node: ParsedNode): ExecutionStep[] {
    const steps: ExecutionStep[] = [];
    let stepCounter = 1;

    const processNode = (currentNode: ParsedNode, depth: number = 0): void => {
      // Process children first (bottom-up for PostgreSQL)
      currentNode.children.forEach(child => processNode(child, depth + 1));

      const explanation = getNodeExplanation(currentNode);
      const performanceIssues = detectPerformanceIssues(currentNode);

      steps.push({
        stepNumber: stepCounter++,
        description: explanation.description,
        nodeType: currentNode.nodeType || currentNode.operation || 'Unknown',
        tableName: currentNode.tableName,
        indexName: currentNode.indexName,
        estimatedRows: currentNode.rows,
        actualRows: currentNode.actualRows,
        cost: currentNode.cost?.total,
        performanceNotes: explanation.performanceNotes || [],
        warnings: [...(explanation.warnings || []), ...performanceIssues]
      });
    };

    processNode(node);
    return steps;
  }

  private generateDetailedSummary(rootNode: ParsedNode, steps: ExecutionStep[]): string {
    if (steps.length === 0) return "No execution steps found.";

    // Analyze the query structure
    const scanSteps = steps.filter(s => s.nodeType.includes('Scan'));
    const joinSteps = steps.filter(s => s.nodeType.includes('Loop') || s.nodeType.includes('Join'));
    const sortSteps = steps.filter(s => s.nodeType.includes('Sort'));
    const limitSteps = steps.filter(s => s.nodeType.includes('Limit'));
    const gatherSteps = steps.filter(s => s.nodeType.includes('Gather'));
    
    let summary = "This query ";

    // Describe the main data access pattern
    if (scanSteps.length > 0) {
      const mainScan = scanSteps[0];
      if (mainScan.nodeType.includes('Parallel')) {
        summary += `performs a parallel scan`;
      } else if (mainScan.nodeType.includes('Index')) {
        summary += `uses index lookups`;
      } else {
        summary += `performs table scans`;
      }
      
      // List tables being accessed
      const tables = [...new Set(scanSteps.map(s => s.tableName).filter(Boolean))];
      if (tables.length > 0) {
        summary += ` on ${tables.join(', ')}`;
      }
    }

    // Describe joins
    if (joinSteps.length > 0) {
      summary += `, performs ${joinSteps.length} join operation${joinSteps.length > 1 ? 's' : ''}`;
      const nestedLoops = joinSteps.filter(s => s.nodeType.includes('Nested Loop')).length;
      if (nestedLoops > 0) {
        summary += ` (using nested loops)`;
      }
    }

    // Describe post-processing
    if (sortSteps.length > 0) {
      summary += `, sorts the results`;
    }

    if (limitSteps.length > 0) {
      summary += `, and returns only ${limitSteps[0].estimatedRows} rows`;
    }

    summary += ".";

    // Add execution strategy details
    if (gatherSteps.length > 0) {
      summary += " The query uses parallel execution to improve performance.";
    }

    // Add cost analysis
    const totalCost = rootNode.cost?.total || 0;
    if (totalCost > 50000) {
      summary += ` This is an expensive query with a total cost of ${totalCost.toFixed(0)}.`;
    } else if (totalCost > 10000) {
      summary += ` The query has a moderate cost of ${totalCost.toFixed(0)}.`;
    }

    // Add row count estimation
    const totalRows = rootNode.rows || 0;
    if (totalRows > 0) {
      summary += ` PostgreSQL estimates it will process approximately ${formatNumber(totalRows)} rows.`;
    }

    return summary;
  }

  private formatDetailedStep(step: ExecutionStep): string {
    let description = this.capitalizeFirst(step.description);
    
    // Build a comprehensive step description
    const parts: string[] = [description];
    
    // Add row counts and cost info
    const metrics: string[] = [];
    if (step.estimatedRows !== undefined) {
      metrics.push(`Est. rows: ${formatNumber(step.estimatedRows)}`);
    }
    if (step.actualRows !== undefined) {
      metrics.push(`Actual: ${formatNumber(step.actualRows)}`);
    }
    if (step.cost !== undefined && step.cost > 100) {
      metrics.push(`Cost: ${step.cost.toFixed(0)}`);
    }
    
    if (metrics.length > 0) {
      parts.push(`[${metrics.join(', ')}]`);
    }
    
    // Add performance implications
    if (step.cost && step.cost > 10000) {
      parts.push("⚠️ High cost operation");
    }
    
    if (step.estimatedRows && step.actualRows && 
        (step.actualRows > step.estimatedRows * 10 || 
         step.actualRows < step.estimatedRows / 10)) {
      parts.push("⚠️ Large estimation error");
    }
    
    return parts.join(' ');
  }

  private collectAllWarnings(node: ParsedNode): string[] {
    const warnings: string[] = [];
    
    const collectWarnings = (currentNode: ParsedNode): void => {
      const explanation = getNodeExplanation(currentNode);
      const performanceIssues = detectPerformanceIssues(currentNode);
      
      warnings.push(...(explanation.warnings || []), ...performanceIssues);
      
      currentNode.children.forEach(collectWarnings);
    };

    collectWarnings(node);
    return [...new Set(warnings)].filter(Boolean);
  }

  private collectAllRecommendations(node: ParsedNode): string[] {
    const recommendations: string[] = [];
    
    const collectRecommendations = (currentNode: ParsedNode): void => {
      const explanation = getNodeExplanation(currentNode);
      const nodeRecommendations = generateRecommendations(currentNode);
      
      recommendations.push(...(explanation.recommendations || []), ...nodeRecommendations);
      
      currentNode.children.forEach(collectRecommendations);
    };

    collectRecommendations(node);
    return [...new Set(recommendations)].filter(Boolean);
  }

  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

export function translatePostgreSQLPlan(rootNode: ParsedNode): TranslationResult {
  const translator = new PostgreSQLTranslator();
  return translator.translate(rootNode);
}