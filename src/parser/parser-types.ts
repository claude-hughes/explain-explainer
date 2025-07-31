export interface ParserLine {
  indent: number;
  content: string;
  raw: string;
}

export interface PostgresNodePattern {
  pattern: RegExp;
  extractor: (match: RegExpMatchArray) => Partial<import('../types').ParsedNode>;
}

export interface MySQLNodePattern {
  pattern: RegExp;
  extractor: (match: RegExpMatchArray) => Partial<import('../types').ParsedNode>;
}