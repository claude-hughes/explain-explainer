import { parsePostgresExplain } from '../parser/postgres-parser';
import { translatePostgreSQLPlan } from '../translator/translator';
import { DatabaseType, ParseResult, TranslationResult } from '../types';

const POSTGRES_EXAMPLE = `Limit  (cost=79621.20..79621.66 rows=4 width=195)
   ->  Gather Merge  (cost=79621.20..79621.66 rows=4 width=195)
         Workers Planned: 1
         ->  Sort  (cost=78621.19..78621.20 rows=4 width=195)
               Sort Key: order_task_schedules.priority DESC, (lower(order_task_schedules.time_range))
               ->  Nested Loop  (cost=1.42..78621.15 rows=4 width=195)
                     ->  Nested Loop  (cost=1.14..78616.56 rows=15 width=213)
                           ->  Nested Loop  (cost=0.57..78567.77 rows=15 width=209)
                                 ->  Parallel Seq Scan on order_task_schedules  (cost=0.00..4089.93 rows=20874 width=31)
                                       Filter: (time_range @> '2025-07-30 13:58:22.21271+00'::timestamp with time zone)
                                 ->  Index Scan using order_tasks_pkey on order_tasks  (cost=0.57..3.57 rows=1 width=182)
                                       Index Cond: (id = order_task_schedules.order_task_id)
                                       Filter: (((snooze_until IS NULL) OR (snooze_until < '2025-07-30 13:58:21.86673'::timestamp without time zone)) AND ((status)::text = ANY ('{active,paused,processing}'::text[])))
                           ->  Index Scan using orders_pkey on orders  (cost=0.56..3.25 rows=1 width=8)
                                 Index Cond: (id = order_tasks.order_id)
                     ->  Index Scan using corp_accounts_pkey on corp_accounts  (cost=0.29..0.31 rows=1 width=4)
                           Index Cond: (id = orders.corp_account_id)
                           Filter: ((name)::text ~~* '%%'::text)`;

class ExplainExplainerApp {
  private inputElement: HTMLTextAreaElement;
  private outputElement: HTMLElement;
  private parseBtn: HTMLButtonElement;
  private clearBtn: HTMLButtonElement;
  private examplePostgresBtn: HTMLButtonElement;

  constructor() {
    this.inputElement = document.getElementById('input') as HTMLTextAreaElement;
    this.outputElement = document.getElementById('output') as HTMLElement;
    this.parseBtn = document.getElementById('parseBtn') as HTMLButtonElement;
    this.clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
    this.examplePostgresBtn = document.getElementById('examplePostgresBtn') as HTMLButtonElement;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.parseBtn.addEventListener('click', () => this.parseAndExplain());
    this.clearBtn.addEventListener('click', () => this.clear());
    this.examplePostgresBtn.addEventListener('click', () => this.loadPostgresExample());
    
    // Parse on Ctrl/Cmd + Enter
    this.inputElement.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        this.parseAndExplain();
      }
    });
  }

  private detectDatabaseType(input: string): DatabaseType {
    // PostgreSQL indicators
    if (input.includes('->') || 
        input.includes('cost=') || 
        input.includes('rows=') ||
        input.includes('Planning Time:') ||
        input.includes('Execution Time:')) {
      return 'postgresql';
    }
    
    // MySQL indicators
    if (input.includes('table:') ||
        input.includes('type:') ||
        input.includes('possible_keys:') ||
        input.includes('key:') ||
        input.includes('ref:') ||
        input.includes('Extra:')) {
      return 'mysql';
    }
    
    return 'unknown';
  }

  private parseAndExplain(): void {
    const input = this.inputElement.value.trim();
    
    if (!input) {
      this.showError('Please paste an EXPLAIN output to analyze');
      return;
    }

    try {
      const dbType = this.detectDatabaseType(input);
      
      if (dbType === 'unknown') {
        this.showError('Could not detect database type. Please ensure you\'ve pasted a valid EXPLAIN output from PostgreSQL or MySQL.');
        return;
      }

      let parseResult: ParseResult;
      
      if (dbType === 'postgresql') {
        parseResult = parsePostgresExplain(input);
      } else {
        // MySQL parser will be implemented later
        this.showError('MySQL parsing is not yet implemented. Coming soon!');
        return;
      }

      if (parseResult.error || !parseResult.root) {
        this.showError(`Parsing error: ${parseResult.error || 'Unknown error'}`);
        return;
      }

      let translation: TranslationResult;
      
      if (dbType === 'postgresql') {
        translation = translatePostgreSQLPlan(parseResult.root);
      } else {
        // MySQL translator will be implemented later
        translation = { summary: '', steps: [], warnings: [], recommendations: [] };
      }

      this.displayTranslation(translation, dbType);
      
    } catch (error) {
      this.showError(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private displayTranslation(translation: TranslationResult, dbType: DatabaseType): void {
    let html = '';
    
    // Database badge
    html += `<div class="database-badge ${dbType}">${dbType.toUpperCase()}</div>`;
    
    // Summary
    if (translation.summary) {
      html += `<div class="summary"><strong>Summary:</strong> ${this.escapeHtml(translation.summary)}</div>`;
    }
    
    // Steps
    if (translation.steps.length > 0) {
      html += '<div class="steps">';
      html += '<h3>Execution Steps:</h3>';
      translation.steps.forEach((step, index) => {
        html += `<div class="step"><strong>Step ${index + 1}:</strong> ${this.escapeHtml(step)}</div>`;
      });
      html += '</div>';
    }
    
    // Warnings
    if (translation.warnings.length > 0) {
      html += '<h3>Performance Warnings:</h3>';
      translation.warnings.forEach(warning => {
        html += `<div class="warning">${this.escapeHtml(warning)}</div>`;
      });
    }
    
    // Recommendations
    if (translation.recommendations.length > 0) {
      html += '<h3>Recommendations:</h3>';
      translation.recommendations.forEach(recommendation => {
        html += `<div class="recommendation">${this.escapeHtml(recommendation)}</div>`;
      });
    }
    
    this.outputElement.innerHTML = html;
  }

  private showError(message: string): void {
    this.outputElement.innerHTML = `<div class="error">${this.escapeHtml(message)}</div>`;
  }

  private clear(): void {
    this.inputElement.value = '';
    this.outputElement.innerHTML = '<p style="color: #999;">Your explanation will appear here...</p>';
  }

  private loadPostgresExample(): void {
    this.inputElement.value = POSTGRES_EXAMPLE;
    this.parseAndExplain();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize the app when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new ExplainExplainerApp();
});