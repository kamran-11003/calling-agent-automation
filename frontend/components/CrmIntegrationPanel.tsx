"use client";

import { CrmIntegration, DEFAULT_CRM } from "@/lib/types";

interface Props {
  crm: CrmIntegration;
  onChange: (crm: CrmIntegration) => void;
}

const PROVIDERS = [
  { value: "none", label: "None — disabled" },
  { value: "hubspot", label: "HubSpot" },
  { value: "pipedrive", label: "Pipedrive" },
  { value: "airtable", label: "Airtable" },
  { value: "salesforce", label: "Salesforce" },
  { value: "webhook", label: "Custom Webhook / Zapier / Make" },
];

const PROVIDER_HELP: Record<string, { apiKeyLabel: string; extraFields: React.ReactNode }> = {
  hubspot: {
    apiKeyLabel: "HubSpot Private App Token",
    extraFields: null,
  },
  pipedrive: {
    apiKeyLabel: "Pipedrive API Token",
    extraFields: null,
  },
  airtable: {
    apiKeyLabel: "Airtable Personal Access Token",
    extraFields: (
      <div>
        <label className="block text-xs text-gray-400 mb-1">Base ID / Table Name</label>
        <p className="text-xs text-gray-500 mb-1">Format: <code className="bg-white/5 px-1 rounded">appXXXXX/TableName</code></p>
      </div>
    ),
  },
  salesforce: {
    apiKeyLabel: "Salesforce OAuth Access Token",
    extraFields: (
      <div>
        <label className="block text-xs text-gray-400 mb-1">Salesforce Instance URL</label>
        <p className="text-xs text-gray-500 mb-1">e.g. <code className="bg-white/5 px-1 rounded">https://yourorg.my.salesforce.com</code></p>
      </div>
    ),
  },
  webhook: {
    apiKeyLabel: "Bearer Token (optional)",
    extraFields: (
      <div>
        <label className="block text-xs text-gray-400 mb-1">Webhook URL</label>
        <p className="text-xs text-gray-500 mb-1">Zapier Catch Hook, Make webhook, n8n, etc.</p>
      </div>
    ),
  },
};

export default function CrmIntegrationPanel({ crm, onChange }: Props) {
  const update = (patch: Partial<CrmIntegration>) => onChange({ ...crm, ...patch });

  const isActive = crm.provider !== "none";
  const help = PROVIDER_HELP[crm.provider];

  const needsBaseUrl = ["airtable", "salesforce", "webhook"].includes(crm.provider);
  const baseUrlLabel: Record<string, string> = {
    airtable: "Base ID / Table Name",
    salesforce: "Instance URL",
    webhook: "Webhook URL",
  };

  const addFieldMapping = () => {
    update({ field_mapping: { ...crm.field_mapping, "": "" } });
  };

  const updateMapping = (oldKey: string, newKey: string, value: string) => {
    const m = { ...crm.field_mapping };
    if (oldKey !== newKey) delete m[oldKey];
    if (newKey) m[newKey] = value;
    update({ field_mapping: m });
  };

  const removeMapping = (key: string) => {
    const m = { ...crm.field_mapping };
    delete m[key];
    update({ field_mapping: m });
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-white mb-0.5">CRM Integration</p>
        <p className="text-xs text-gray-400">
          Automatically push extracted lead data to your CRM after each call.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">CRM Provider</label>
          <select
            value={crm.provider}
            onChange={e => update({ provider: e.target.value as CrmIntegration["provider"], enabled: e.target.value !== "none" })}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            {PROVIDERS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {isActive && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">Push Trigger</label>
            <select
              value={crm.trigger}
              onChange={e => update({ trigger: e.target.value as CrmIntegration["trigger"] })}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="hot_warm">Hot + Warm leads only</option>
              <option value="hot_only">Hot leads only</option>
              <option value="any">All calls</option>
            </select>
          </div>
        )}
      </div>

      {isActive && (
        <>
          {/* API Key */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              {help?.apiKeyLabel || "API Key / Token"}
            </label>
            <input
              type="password"
              value={crm.api_key}
              onChange={e => update({ api_key: e.target.value })}
              placeholder="Paste your API key here"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Stored encrypted. Never exposed in logs.</p>
          </div>

          {/* Base URL / extra field */}
          {needsBaseUrl && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">{baseUrlLabel[crm.provider]}</label>
              <input
                value={crm.base_url}
                onChange={e => update({ base_url: e.target.value })}
                placeholder={
                  crm.provider === "airtable"
                    ? "appXXXXXX/Leads"
                    : crm.provider === "salesforce"
                    ? "https://yourorg.my.salesforce.com"
                    : "https://hooks.zapier.com/hooks/catch/xxx/yyy"
                }
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
          )}

          {/* Pipedrive pipeline */}
          {crm.provider === "pipedrive" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Pipeline ID (optional)</label>
              <input
                value={crm.pipeline_id}
                onChange={e => update({ pipeline_id: e.target.value })}
                placeholder="1"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {/* Field Mapping */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div>
                <label className="text-xs text-gray-400">Field Mapping</label>
                <p className="text-xs text-gray-600">Map our extracted fields → CRM field names. Leave empty to use default names.</p>
              </div>
              <button
                onClick={addFieldMapping}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                + Add mapping
              </button>
            </div>
            {Object.entries(crm.field_mapping).map(([key, value]) => (
              <div key={key} className="flex gap-2 mb-1.5 items-center">
                <input
                  defaultValue={key}
                  onBlur={e => updateMapping(key, e.target.value, value)}
                  placeholder="our_field"
                  className="w-2/5 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
                />
                <span className="text-gray-600 text-xs">→</span>
                <input
                  value={value}
                  onChange={e => updateMapping(key, key, e.target.value)}
                  placeholder="crm_field_name"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
                />
                <button onClick={() => removeMapping(key)} className="text-gray-500 hover:text-red-400 text-xs px-1">✕</button>
              </div>
            ))}
            {Object.keys(crm.field_mapping).length === 0 && (
              <p className="text-xs text-gray-600 italic">No custom mappings — default field names will be used.</p>
            )}
          </div>

          {/* Status indicator */}
          <div className="flex items-center gap-2 p-3 bg-emerald-950/30 border border-emerald-500/20 rounded-lg">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <p className="text-xs text-emerald-300">
              CRM integration active — leads will be pushed to <strong>{crm.provider}</strong> after each qualifying call.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
