/** Run 页 collect 下拉：同 TC 编号时用 spec 短名 + 方法名区分。 */
export interface CollectItemLike {
  nodeId: string;
  name: string;
  tc: string | null;
}

const SPEC_SHORT_NAMES: Record<string, string> = {
  test_sales_portal_5gbb_0929: "5GBB-0929",
  test_sales_portal_order: "Order",
  test_sales_portal: "Portal",
};

function specShortName(specFile: string): string {
  return SPEC_SHORT_NAMES[specFile] ?? specFile;
}

export function formatCollectOptionLabel(item: CollectItemLike): string {
  const parts = item.nodeId.split("::");
  const fn = (parts[parts.length - 1] ?? "").replace(/\[.*\]$/, "");
  const specFile = (parts[0] ?? "").replace(/^specs\//, "").replace(/\.py$/, "");
  const spec = specShortName(specFile);
  const slug = fn.startsWith("test_") ? fn.slice(5).replace(/_/g, " ") : fn;
  const method = item.name && item.tc && item.name !== item.tc ? item.name : slug;

  if (item.tc) {
    return `${item.tc} · ${spec} · ${method}`;
  }
  return method || spec || item.name;
}
