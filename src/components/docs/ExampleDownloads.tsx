/** Local synthetic inputs; linked as normal public assets, just like upload templates. */
const files = ["suppliers.csv", "materials.csv", "products.csv", "customers.csv", "bom_single_level.csv", "inbound_logistics.csv", "outbound_logistics.csv", "protocol.json", "verification.json"];
export function ExampleDownloads() {
  return <div className="rounded-sm border border-border bg-card p-4 space-y-3">
    <p className="font-semibold text-sm">Download the control-unit example</p>
    <p className="text-sm text-muted-foreground">Seven CSVs for separate upload tabs. Protocol and verification JSON are for inspecting the local experiment; do not upload them as datasets.</p>
    <div className="flex flex-wrap gap-2">{files.map(file => <a key={file} href={`/examples/control-unit/${file}`} download className="inline-flex min-h-11 items-center rounded-sm border border-border px-3 text-sm text-primary hover:bg-muted">{file}</a>)}</div>
  </div>;
}
