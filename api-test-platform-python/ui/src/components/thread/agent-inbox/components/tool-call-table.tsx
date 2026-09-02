/**
 * 版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。
 * 
 * 本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
 * 不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。
 * 
 * 授权商业应用请联系微信：huice666
 */

import { ToolCall } from "@langchain/core/messages/tool";
import { unknownToPrettyDate } from "../utils";

export function ToolCallTable({ toolCall }: { toolCall: ToolCall }) {
  return (
    <div className="max-w-full min-w-[300px] overflow-hidden rounded-lg border">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th
              className="bg-gray-100 px-2 py-0 text-left text-sm"
              colSpan={2}
            >
              {toolCall.name}
            </th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(toolCall.args).map(([key, value]) => {
            let valueStr = "";
            if (["string", "number"].includes(typeof value)) {
              valueStr = value.toString();
            }

            const date = unknownToPrettyDate(value);
            if (date) {
              valueStr = date;
            }

            try {
              valueStr = valueStr || JSON.stringify(value, null);
            } catch (_) {
              // failed to stringify, just assign an empty string
              valueStr = "";
            }

            return (
              <tr
                key={key}
                className="border-t"
              >
                <td className="w-1/3 px-2 py-1 text-xs font-medium">{key}</td>
                <td className="px-2 py-1 font-mono text-xs">{valueStr}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
