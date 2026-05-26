export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  readOnly?: boolean;
  execute(args: any): Promise<string>;
}
