import { ParsedNode, TranslationResult } from '../types';
import { 
  getNodeExplanation, 
  detectPerformanceIssues, 
  generateRecommendations,
  ExecutionStep 
} from './explanations';

export class PostgreSQLTranslator {
  translate(rootNode: ParsedNode): TranslationResult {
    const steps = this.generateExecutionSteps(rootNode);
    const allWarnings = this.collectAllWarnings(rootNode);
    const allRecommendations = this.collectAllRecommendations(rootNode);
    const summary = this.generateSummary(steps);

    return {
      summary,
      steps: steps.map(step => this.formatStep(step)),
      warnings: allWarnings,
      recommendations: allRecommendations
    };
  }

  private generateExecutionSteps(node: ParsedNode): ExecutionStep[] {
    const steps: ExecutionStep[] = [];
    let stepCounter = 1;

    const processNode = (currentNode: ParsedNode, depth: number = 0): void => {
      currentNode.children.forEach(child => processNode(child, depth + 1));

      const explanation = getNodeExplanation(currentNode);
      const performanceIssues = detectPerformanceIssues(currentNode);
      const recommendations = generateRecommendations(currentNode);

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

  private generateSummary(steps: ExecutionStep[]): string {
    if (steps.length === 0) {
      return "No execution steps found in the query plan.";
    }

    const scanOperations = steps.filter(step => 
      step.nodeType.includes('Scan')
    );
    const joinOperations = steps.filter(step => 
      step.nodeType.includes('Join') || step.nodeType.includes('Nested Loop')
    );
    const parallelOperations = steps.filter(step => 
      step.nodeType.includes('Parallel') || step.nodeType.includes('Gather')
    );
    const sortOperations = steps.filter(step => step.nodeType === 'Sort');
    const limitOperations = steps.filter(step => step.nodeType === 'Limit');

    let summary = "The database will execute this query by ";

    if (scanOperations.length > 0) {
      const firstScan = scanOperations[0];
      if (firstScan.nodeType.includes('Parallel')) {
        summary += `first performing a parallel sequential scan on the ${firstScan.tableName} table using ${this.getWorkerCount(steps)} worker process${this.getWorkerCount(steps) > 1 ? 'es' : ''}`;
      } else if (firstScan.nodeType.includes('Index')) {
        summary += `first looking up rows in the ${firstScan.tableName} table using the ${firstScan.indexName} index`;
      } else {
        summary += `first scanning the ${firstScan.tableName} table`;
      }

      if (this.hasFilter(firstScan)) {
        summary += ', filtering for matching rows';
      }
      
      if (scanOperations.length > 1) {
        const additionalTables = [...new Set(scanOperations.slice(1).map(s => s.tableName).filter(Boolean))];
        summary += `. For each matching row, it will then look up related data from ${additionalTables.join(', ')}`;
      }
    }

    if (joinOperations.length > 0) {
      summary += `, joining the results together`;
    }

    if (sortOperations.length > 0) {
      summary += `, sorting the results`;
    }

    if (limitOperations.length > 0) {
      const limitStep = limitOperations[limitOperations.length - 1];
      summary += `, and finally limiting to ${limitStep.estimatedRows} row${limitStep.estimatedRows === 1 ? '' : 's'}`;
    }

    if (parallelOperations.length > 0) {
      summary += `. The parallel execution will be gathered and merged to maintain the sort order`;
    }

    summary += ".";

    return summary;
  }

  private getWorkerCount(steps: ExecutionStep[]): number {
    const parallelSteps = steps.filter(step => step.nodeType.includes('Parallel') || step.nodeType.includes('Gather'));
    return parallelSteps.length > 0 ? 1 : 1; // Default to 1 for now, could be extracted from plan
  }

  private hasFilter(step: ExecutionStep): boolean {
    return step.description.includes('filtering for');
  }

  private formatStep(step: ExecutionStep): string {
    let description = `Step ${step.stepNumber}: ${this.capitalizeFirst(step.description)}`;
    
    if (step.cost && step.cost > 1000) {
      description += ` (high cost: ${step.cost.toFixed(2)})`;
    }
    
    if (step.performanceNotes.length > 0) {
      description += ` - ${step.performanceNotes.join(', ')}`;
    }
    
    if (step.warnings.length > 0) {
      description += ` ⚠️ ${step.warnings.join(', ')}`;
    }
    
    return description;
  }

  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private formatNumber(num: number): string {
    if (num < 1000) return num.toString();
    if (num < 1000000) return `${(num / 1000).toFixed(1)}K`;
    return `${(num / 1000000).toFixed(1)}M`;
  }
}

export function translatePostgreSQLPlan(rootNode: ParsedNode): TranslationResult {
  const translator = new PostgreSQLTranslator();
  return translator.translate(rootNode);
}