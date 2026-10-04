export type Severity = "error" | "warning";
export type Issue = { severity: Severity; where: string; message: string };

export class Issues {
  readonly list: Issue[] = [];
  error(where: string, message: string): void {
    this.list.push({ severity: "error", where, message });
  }
  warn(where: string, message: string): void {
    this.list.push({ severity: "warning", where, message });
  }
  get errors(): Issue[] {
    return this.list.filter((i) => i.severity === "error");
  }
  get warnings(): Issue[] {
    return this.list.filter((i) => i.severity === "warning");
  }
  get ok(): boolean {
    return this.errors.length === 0;
  }
  format(): string {
    return this.list.map((i) => `${i.severity === "error" ? "✖" : "⚠"} ${i.where}: ${i.message}`).join("\n");
  }
}
