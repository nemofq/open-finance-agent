/**
 * Every kind of LLM provider the app can talk to, stated once. The config schema derives each
 * type's shape and its allowed auth from a row, and the settings catalog derives its labels and
 * "Add provider" rows, so a type's auth kinds cannot disagree between what config.json accepts and
 * what the dialog offers.
 *
 * Browser-safe: data and types only, read by `src/lib/config/schema.ts` and `src/lib/llm/catalog.ts`.
 */

/** How an instance authenticates: a key the user pasted, or an account they signed in to. */
export const llmAuthKinds = ["api_key", "oauth"] as const;

export type LlmAuthKind = (typeof llmAuthKinds)[number];

/**
 * Where a row sits in the dialog's "More providers" list. Featured rows are shown before it is
 * opened; a search looks through every row.
 */
export const llmProviderCategories = {
  maker: "Model makers",
  host: "Open-model hosts",
  gateway: "Gateways",
  cloud: "Cloud platforms",
  custom: "Custom endpoint",
} as const;

export type LlmProviderCategory = keyof typeof llmProviderCategories;

/**
 * One way a key instance proves who it is, where a type has more than one: Bedrock takes a bearer
 * token, access keys or a profile. The first is the default.
 */
export interface LlmSetupMethod {
  id: string;
  name: string;
  description: string;
  /** What the key field is called under this method; a method without one takes no key. */
  key?: { label: string };
}

/**
 * A value besides the key that pi needs to reach the account: an account id, a region, a project.
 * Saved in the instance's `settings` under `name`, which is the name pi reads it by.
 */
export interface LlmSetupField {
  name: string;
  label: string;
  placeholder?: string;
  help?: string;
  optional?: boolean;
  /** Masked like the key. */
  secret?: boolean;
  /** The methods that ask for it; every method when unset. */
  methods?: readonly string[];
}

/** What a key instance of a type asks for beyond the key itself. */
export interface LlmProviderSetup {
  methods?: readonly [LlmSetupMethod, ...LlmSetupMethod[]];
  fields: readonly LlmSetupField[];
}

/**
 * Regional editions and plans of one company, which are separate pi providers with separate keys
 * but one row in the dialog until one of them is picked.
 */
export const llmProviderFamilies = {
  moonshot: { name: "Moonshot AI", description: "Kimi models from Moonshot's own platform, priced per token." },
  zai: { name: "Z.AI GLM Coding Plan", description: "GLM models from Zhipu on the GLM Coding Plan subscription." },
  minimax: { name: "MiniMax", description: "MiniMax models from MiniMax's own platform, by token or on a token plan." },
  xiaomi: { name: "Xiaomi MiMo", description: "MiMo models from Xiaomi, by token or on a token plan." },
  qwen: { name: "Qwen Token Plan", description: "Qwen models on an Alibaba Cloud Model Studio token-plan subscription." },
} as const satisfies Record<string, { name: string; description: string }>;

export type LlmProviderFamily = keyof typeof llmProviderFamilies;

/** What one row says about a provider type. */
export interface LlmProviderTypeFacts {
  /** Name shown in the "Add provider" list, and the default name of a new instance. */
  name: string;
  description: string;
  keyHelp: { text: string; url?: string };
  /**
   * How an instance may authenticate; each kind is a row of its own in the "Add provider" list.
   * The config schema accepts exactly these, so a config cannot ask for a login a type has no flow for.
   */
  authKinds: readonly [LlmAuthKind, ...LlmAuthKind[]];
  /**
   * Whether the type can be added more than once. A single-instance ("hosted") type is registered
   * under its own id, which must be a pi-ai provider id because pi keys credentials by it; a
   * multi-instance type is an endpoint the user names, and needs a config schema of its own.
   */
  multiple: boolean;
  category: LlmProviderCategory;
  /** Shown before "More providers" is opened: the providers most people come to add. */
  featured?: boolean;
  /** The company whose single dialog row this type sits under, and what that row calls it. */
  family?: { id: LlmProviderFamily; variant: string };
  /** Set where an instance that authenticates by key may have none, as an endpoint may. */
  keyOptional?: boolean;
  /** What a key instance asks for besides the key; see `LlmProviderSetup`. */
  setup?: LlmProviderSetup;
  /**
   * Fields besides `apiKey` that hold a secret, as dotted paths inside the instance (`*` for any
   * key). Settings masks them before the config reaches the browser, as it masks `apiKey`. A
   * `setup` field marked `secret` is added on its own.
   */
  secretFields?: readonly string[];
}

/**
 * One row per type, in the order the "Add provider" dialog lists them: the featured rows first, in
 * the order they are shown, then the rest by category. The key is the type id saved in
 * config.json, and never changes once shipped; for a hosted type it is pi-ai's provider id.
 */
export const llmProviderTypeTable = {
  openrouter: {
    name: "OpenRouter",
    description: "Hundreds of hosted models behind one key, priced per token.",
    keyHelp: {
      text: "Create a key at openrouter.ai/keys. Usage is pay-as-you-go; you can cap spend per key.",
      url: "https://openrouter.ai/keys",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "gateway",
    featured: true,
  },
  anthropic: {
    name: "Anthropic",
    description: "Claude models straight from Anthropic, priced per token.",
    keyHelp: {
      text: "Create a key at console.anthropic.com/settings/keys. It is billed per token, separately from any Claude subscription.",
      url: "https://console.anthropic.com/settings/keys",
    },
    authKinds: ["api_key", "oauth"],
    multiple: false,
    category: "maker",
    featured: true,
  },
  "openai-codex": {
    name: "ChatGPT (Codex)",
    description: "Use a ChatGPT Plus, Pro or Business plan through the Codex backend.",
    keyHelp: { text: "Signed in with your ChatGPT account; no API key is involved." },
    authKinds: ["oauth"],
    multiple: false,
    category: "maker",
    featured: true,
  },
  "github-copilot": {
    name: "GitHub Copilot",
    description: "Use a GitHub Copilot subscription, with the models your account has enabled.",
    keyHelp: { text: "Signed in with your GitHub account; no API key is involved." },
    authKinds: ["oauth"],
    multiple: false,
    category: "gateway",
    featured: true,
  },
  openai: {
    name: "OpenAI",
    description: "GPT models straight from OpenAI, priced per token.",
    keyHelp: {
      text: "Create a key at platform.openai.com/api-keys. The project it belongs to is billed per token.",
      url: "https://platform.openai.com/api-keys",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
    featured: true,
  },
  google: {
    name: "Google Gemini",
    description: "Gemini models from Google AI Studio, priced per token.",
    keyHelp: {
      text: "Create a key at aistudio.google.com/apikey. The free tier is rate-limited; adding billing lifts the limits.",
      url: "https://aistudio.google.com/apikey",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
    featured: true,
  },
  xai: {
    name: "xAI",
    description: "Grok models straight from xAI, priced per token.",
    keyHelp: {
      text: "Create a key at console.x.ai. Usage is billed per token against prepaid credits.",
      url: "https://console.x.ai/team/default/api-keys",
    },
    authKinds: ["api_key", "oauth"],
    multiple: false,
    category: "maker",
    featured: true,
  },
  deepseek: {
    name: "DeepSeek",
    description: "DeepSeek's own models, priced per token and among the cheapest.",
    keyHelp: {
      text: "Create a key at platform.deepseek.com/api_keys. Usage is billed per token against a topped-up balance.",
      url: "https://platform.deepseek.com/api_keys",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
    featured: true,
  },
  opencode: {
    name: "OpenCode Zen",
    description: "A curated set of coding models behind one key, priced per token.",
    keyHelp: {
      text: "Create a key for OpenCode Zen at opencode.ai/docs/zen. Usage is pay-as-you-go.",
      url: "https://opencode.ai/docs/zen/",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "gateway",
    featured: true,
  },
  "opencode-go": {
    name: "OpenCode Go",
    description: "OpenCode's monthly subscription for open models: GLM, Kimi, DeepSeek, Qwen, MiniMax and more.",
    keyHelp: {
      text: "Subscribe to Go at opencode.ai/auth and copy your key there. It is the same key as Zen, but Go models need the subscription. OpenCode designs Go for coding agents and monitors its traffic.",
      url: "https://opencode.ai/auth",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "gateway",
    featured: true,
  },
  "openai-compatible": {
    name: "OpenAI-compatible endpoint",
    description: "Any server that speaks the OpenAI Chat Completions API: vLLM, LiteLLM, Ollama, LM Studio, a gateway.",
    keyHelp: { text: "Leave empty if the endpoint does not require a key." },
    authKinds: ["api_key"],
    multiple: true,
    category: "custom",
    featured: true,
    keyOptional: true,
  },

  mistral: {
    name: "Mistral",
    description: "Mistral's models from La Plateforme, priced per token.",
    keyHelp: {
      text: "Create a key at console.mistral.ai/api-keys. Usage is billed per token.",
      url: "https://console.mistral.ai/api-keys",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
  },
  meta: {
    name: "Meta",
    description: "Muse Spark models straight from Meta's Model API, priced per token.",
    keyHelp: { text: "Paste a Meta Model API key. Usage is billed per token." },
    authKinds: ["api_key", "oauth"],
    multiple: false,
    category: "maker",
  },
  moonshotai: {
    name: "Moonshot AI",
    description: "Kimi models from Moonshot's global platform, priced per token.",
    keyHelp: {
      text: "Create a key at platform.kimi.ai (formerly platform.moonshot.ai). Usage is billed per token against a topped-up balance.",
      url: "https://platform.kimi.ai/console/api-keys",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
    family: { id: "moonshot", variant: "Global (platform.kimi.ai)" },
  },
  "moonshotai-cn": {
    name: "Moonshot AI China",
    description: "Kimi models from Moonshot's China platform, priced per token in yuan.",
    keyHelp: {
      text: "Create a key at platform.kimi.com (formerly platform.moonshot.cn). A key from the global platform does not work here.",
      url: "https://platform.kimi.com/console/api-keys",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
    family: { id: "moonshot", variant: "China (platform.kimi.com)" },
  },
  "kimi-coding": {
    name: "Kimi For Coding",
    description: "Kimi models on a Kimi Code membership, with a key from its console.",
    keyHelp: {
      text: "Create a key in the Kimi Code console. It draws on your membership's limits, not on API credit.",
      url: "https://www.kimi.com/code/console",
    },
    authKinds: ["api_key", "oauth"],
    multiple: false,
    category: "maker",
  },
  zai: {
    name: "Z.AI Coding Plan",
    description: "GLM models on z.ai's GLM Coding Plan subscription.",
    keyHelp: {
      text: "Subscribe to the GLM Coding Plan at z.ai, then create a key there. A pay-per-token key without the plan does not work here.",
      url: "https://z.ai/manage-apikey/apikey-list",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
    family: { id: "zai", variant: "Global (z.ai)" },
  },
  "zai-coding-cn": {
    name: "Z.AI Coding Plan China",
    description: "GLM models on bigmodel.cn's GLM Coding Plan subscription, in China.",
    keyHelp: {
      text: "Subscribe to the GLM Coding Plan at bigmodel.cn, then create a key there.",
      url: "https://bigmodel.cn/coding-plan/personal/overview",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
    family: { id: "zai", variant: "China (bigmodel.cn)" },
  },
  minimax: {
    name: "MiniMax",
    description: "MiniMax models from MiniMax's global platform.",
    keyHelp: {
      text: "Create a key at platform.minimax.io. It draws on a pay-as-you-go balance or a token plan.",
      url: "https://platform.minimax.io/user-center/basic-information/interface-key",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
    family: { id: "minimax", variant: "Global (minimax.io)" },
  },
  "minimax-cn": {
    name: "MiniMax China",
    description: "MiniMax models from MiniMax's China platform.",
    keyHelp: {
      text: "Create a key at platform.minimaxi.com. A key from the global platform does not work here.",
      url: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
    family: { id: "minimax", variant: "China (minimaxi.com)" },
  },
  xiaomi: {
    name: "Xiaomi MiMo",
    description: "MiMo models from Xiaomi's API platform, priced per token.",
    keyHelp: {
      text: "Create a pay-as-you-go key (it starts with sk-) at platform.xiaomimimo.com. Usage is billed per token.",
      url: "https://platform.xiaomimimo.com/#/console/api-keys",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
    family: { id: "xiaomi", variant: "Pay per token" },
  },
  "xiaomi-token-plan-sgp": {
    name: "Xiaomi MiMo Token Plan (Singapore)",
    description: "MiMo models on a Xiaomi token plan, served from Singapore.",
    keyHelp: {
      text: "Create a token-plan key for the Singapore region at platform.xiaomimimo.com. A pay-as-you-go key does not work here.",
      url: "https://platform.xiaomimimo.com/#/console/plan-manage",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
    family: { id: "xiaomi", variant: "Token Plan, Singapore" },
  },
  "xiaomi-token-plan-ams": {
    name: "Xiaomi MiMo Token Plan (Europe)",
    description: "MiMo models on a Xiaomi token plan, served from Amsterdam.",
    keyHelp: {
      text: "Create a token-plan key for the Europe (Amsterdam) region at platform.xiaomimimo.com. A pay-as-you-go key does not work here.",
      url: "https://platform.xiaomimimo.com/#/console/plan-manage",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
    family: { id: "xiaomi", variant: "Token Plan, Europe" },
  },
  "xiaomi-token-plan-cn": {
    name: "Xiaomi MiMo Token Plan (China)",
    description: "MiMo models on a Xiaomi token plan, served from China.",
    keyHelp: {
      text: "Create a token-plan key for the China region at platform.xiaomimimo.com. A pay-as-you-go key does not work here.",
      url: "https://platform.xiaomimimo.com/#/console/plan-manage",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
    family: { id: "xiaomi", variant: "Token Plan, China" },
  },
  "qwen-token-plan": {
    name: "Qwen Token Plan",
    description: "Qwen models on a team token plan from Alibaba Cloud Model Studio's international site.",
    keyHelp: {
      text: "Once an admin has assigned you a seat, create a key (it starts with sk-sp-) under Token Plan in Model Studio.",
      url: "https://modelstudio.console.alibabacloud.com/ap-southeast-1/subscription/token-plan",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
    family: { id: "qwen", variant: "Team, international" },
  },
  "qwen-token-plan-cn": {
    name: "Qwen Token Plan China",
    description: "Qwen models on a personal token plan from Alibaba Cloud Bailian, in China.",
    keyHelp: {
      text: "Create a key (it starts with sk-sp-) under Token Plan in the Bailian console.",
      url: "https://bailian.console.aliyun.com/cn-beijing/subscription/token-plan/personal",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
    family: { id: "qwen", variant: "Personal, China" },
  },
  "qwen-token-plan-individual": {
    name: "Qwen Token Plan Individual",
    description: "Qwen models on a personal token plan from Alibaba Cloud Model Studio's international site.",
    keyHelp: {
      text: "Create a key under Token Plan › My Subscription in Model Studio. The plan is meant for interactive tools.",
      url: "https://modelstudio.console.alibabacloud.com/ap-southeast-1/subscription/token-plan",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
    family: { id: "qwen", variant: "Personal, international" },
  },
  "ant-ling": {
    name: "Ant Ling",
    description: "Ling models from Ant Group, priced per token.",
    keyHelp: {
      text: "Create a token at chat.ant-ling.com/open. Usage is billed per token against a topped-up balance.",
      url: "https://chat.ant-ling.com/open",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "maker",
  },

  groq: {
    name: "Groq",
    description: "Open models on Groq's fast inference hardware, priced per token.",
    keyHelp: {
      text: "Create a key at console.groq.com/keys. There is a rate-limited free tier.",
      url: "https://console.groq.com/keys",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "host",
  },
  cerebras: {
    name: "Cerebras",
    description: "Open models on Cerebras's fast inference hardware, priced per token.",
    keyHelp: {
      text: "Create a key at cloud.cerebras.ai. There is a rate-limited free tier.",
      url: "https://cloud.cerebras.ai",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "host",
  },
  together: {
    name: "Together AI",
    description: "Open models hosted by Together AI, priced per token.",
    keyHelp: {
      text: "Create a key at api.together.ai/settings/api-keys. Usage is billed per token.",
      url: "https://api.together.ai/settings/api-keys",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "host",
  },
  fireworks: {
    name: "Fireworks AI",
    description: "Open models hosted by Fireworks AI, priced per token.",
    keyHelp: {
      text: "Create a key in the Fireworks console under Settings › API keys. Usage is billed per token.",
      url: "https://app.fireworks.ai/settings/users/api-keys",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "host",
  },
  baseten: {
    name: "Baseten",
    description: "Open models on Baseten's model APIs, priced per token.",
    keyHelp: {
      text: "Create a key at app.baseten.co/settings/api_keys. Usage is billed per token.",
      url: "https://app.baseten.co/settings/api_keys",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "host",
  },
  nvidia: {
    name: "NVIDIA",
    description: "Open models on NVIDIA's hosted NIM APIs at build.nvidia.com.",
    keyHelp: {
      text: "Create a key at build.nvidia.com. Access through the NVIDIA Developer Program is free and rate-limited.",
      url: "https://build.nvidia.com/settings/api-keys",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "host",
  },
  huggingface: {
    name: "Hugging Face",
    description: "Open models through Hugging Face Inference Providers, billed to your account.",
    keyHelp: {
      text: "Create a fine-grained token with permission to make calls to Inference Providers. Monthly free credits, then pay-as-you-go.",
      url: "https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "host",
  },
  "cloudflare-workers-ai": {
    name: "Cloudflare Workers AI",
    description: "Open models on Cloudflare's network, billed to your Cloudflare account.",
    keyHelp: {
      text: "Under AI › Workers AI › Use REST API in the Cloudflare dashboard, create a token with Workers AI Read and Edit.",
      url: "https://dash.cloudflare.com/?to=/:account/ai/workers-ai",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "host",
    setup: {
      fields: [
        {
          name: "CLOUDFLARE_ACCOUNT_ID",
          label: "Account ID",
          placeholder: "32 hexadecimal characters",
          help: "Shown on the same Use REST API page.",
        },
      ],
    },
  },

  "vercel-ai-gateway": {
    name: "Vercel AI Gateway",
    description: "Models from many providers through Vercel's gateway, billed to your Vercel team.",
    keyHelp: {
      text: "Create a key under AI Gateway › API Keys in your Vercel dashboard. Usage is billed per token against credits.",
      url: "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "gateway",
  },
  "cloudflare-ai-gateway": {
    name: "Cloudflare AI Gateway",
    description: "Models from many providers through a Cloudflare AI Gateway you set up.",
    keyHelp: {
      text: "Create an API token with AI Gateway Read and Edit, and Workers AI Read, at dash.cloudflare.com/profile/api-tokens.",
      url: "https://dash.cloudflare.com/profile/api-tokens",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "gateway",
    setup: {
      fields: [
        {
          name: "CLOUDFLARE_ACCOUNT_ID",
          label: "Account ID",
          placeholder: "32 hexadecimal characters",
          help: "Shown on your Cloudflare dashboard's account home, under Account details.",
        },
        {
          name: "CLOUDFLARE_GATEWAY_ID",
          label: "Gateway ID",
          placeholder: "default",
          help: "The gateway's name under AI › AI Gateway; Cloudflare creates one called default.",
        },
      ],
    },
  },

  "amazon-bedrock": {
    name: "Amazon Bedrock",
    description: "Claude, Llama, Nova and other models in your AWS account, billed by AWS.",
    keyHelp: {
      text: "Create a key under API keys in the Bedrock console. A short-term key lasts up to 12 hours.",
      url: "https://console.aws.amazon.com/bedrock",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "cloud",
    setup: {
      methods: [
        {
          id: "bearer-token",
          name: "Bedrock API key",
          description: "A key from the Bedrock console, the quickest way in.",
          key: { label: "API key" },
        },
        { id: "access-keys", name: "Access keys", description: "An IAM user's access key ID and secret access key." },
        { id: "profile", name: "AWS profile", description: "A named profile from the AWS CLI on this machine." },
      ],
      fields: [
        {
          name: "AWS_ACCESS_KEY_ID",
          label: "Access key ID",
          placeholder: "AKIA…",
          methods: ["access-keys"],
        },
        {
          name: "AWS_SECRET_ACCESS_KEY",
          label: "Secret access key",
          secret: true,
          methods: ["access-keys"],
        },
        {
          name: "AWS_SESSION_TOKEN",
          label: "Session token",
          secret: true,
          optional: true,
          help: "Only for temporary credentials.",
          methods: ["access-keys"],
        },
        {
          name: "AWS_PROFILE",
          label: "Profile",
          placeholder: "default",
          help: "A profile in ~/.aws/config or ~/.aws/credentials on this machine, SSO profiles included.",
          methods: ["profile"],
        },
        {
          name: "AWS_REGION",
          label: "Region",
          placeholder: "us-east-1",
          help: "The region requests go to. Anthropic models first ask for a one-time use-case form in the Bedrock console.",
        },
      ],
    },
  },
  "google-vertex": {
    name: "Google Vertex AI",
    description: "Gemini and partner models in your Google Cloud project, billed by Google Cloud.",
    keyHelp: {
      text: "Create an API key bound to a service account in the Google Cloud console, in the project the models are enabled in.",
      url: "https://console.cloud.google.com/agent-platform/studio/settings/api-keys",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "cloud",
    setup: {
      methods: [
        {
          id: "api-key",
          name: "API key",
          description: "An API key bound to a service account; no project or location needed.",
          key: { label: "API key" },
        },
        {
          id: "adc",
          name: "gcloud sign-in",
          description: "The credentials gcloud auth application-default login left on this machine.",
        },
        {
          id: "service-account",
          name: "Service account file",
          description: "A service account's JSON key file on this machine.",
        },
      ],
      fields: [
        {
          name: "GOOGLE_APPLICATION_CREDENTIALS",
          label: "Credentials file",
          placeholder: "/path/to/service-account.json",
          help: "The full path of a service account key file on this machine.",
          methods: ["service-account"],
        },
        {
          name: "GOOGLE_CLOUD_PROJECT",
          label: "Project ID",
          placeholder: "my-project",
          help: "The ID of the Google Cloud project the models are enabled in.",
          methods: ["adc", "service-account"],
        },
        {
          name: "GOOGLE_CLOUD_LOCATION",
          label: "Location",
          placeholder: "global",
          help: "A Vertex AI region such as us-central1, or global.",
          methods: ["adc", "service-account"],
        },
      ],
    },
  },
  "azure-openai-responses": {
    name: "Azure OpenAI",
    description: "OpenAI models deployed in your Azure resource, billed by Azure.",
    keyHelp: {
      text: "Copy a key from your resource's Keys and Endpoint page in the Azure portal. Each model is called by its deployment name.",
      url: "https://portal.azure.com",
    },
    authKinds: ["api_key"],
    multiple: false,
    category: "cloud",
    setup: {
      fields: [
        {
          name: "AZURE_OPENAI_BASE_URL",
          label: "Endpoint",
          placeholder: "https://my-resource.openai.azure.com",
          help: "From the same Keys and Endpoint page.",
        },
        {
          name: "AZURE_OPENAI_DEPLOYMENT_NAME_MAP",
          label: "Deployment names",
          placeholder: "gpt-5=my-gpt5, gpt-5-mini=mini",
          help: "Only for deployments not named after their model: model=deployment, separated by commas.",
          optional: true,
        },
      ],
    },
  },
} as const satisfies Record<string, LlmProviderTypeFacts>;

type Table = typeof llmProviderTypeTable;

export type LlmProviderType = keyof Table;

/** A type added once and registered under its own id, which is a pi-ai provider id. */
export type HostedLlmProviderType = {
  [T in LlmProviderType]: Table[T]["multiple"] extends true ? never : T;
}[LlmProviderType];

/** A type added as many times as the user has endpoints, each under an id the user names. */
export type EndpointLlmProviderType = Exclude<LlmProviderType, HostedLlmProviderType>;

/** The auth kinds a type's row offers, as a union. */
export type LlmAuthKindOf<T extends LlmProviderType> = Table[T]["authKinds"][number];

/** Every type, in table order. */
export const llmProviderTypes = Object.keys(llmProviderTypeTable) as LlmProviderType[];

export function llmProviderTypeFacts(type: LlmProviderType): LlmProviderTypeFacts {
  return llmProviderTypeTable[type];
}

function isHostedType(type: LlmProviderType): type is HostedLlmProviderType {
  return !llmProviderTypeFacts(type).multiple;
}

export const hostedLlmProviderTypes: HostedLlmProviderType[] = llmProviderTypes.filter(isHostedType);

/**
 * Whether an instance that authenticates by key cannot work without one. Derived rather than
 * stated: a type that offers a key needs it, unless its row says the key is optional.
 */
export function keyRequired(type: LlmProviderType): boolean {
  const facts = llmProviderTypeFacts(type);
  return facts.authKinds.includes("api_key") && facts.keyOptional !== true;
}

/** Every instance keeps its key in `apiKey`, whatever its type. */
const sharedSecretFields = ["apiKey"];

/** The secret fields one row declares, as paths inside an instance: its own, and its secret `setup` fields. */
function rowSecretFields(row: LlmProviderTypeFacts): string[] {
  const settings = (row.setup?.fields ?? []).filter((field) => field.secret).map((field) => `settings.${field.name}`);
  return [...(row.secretFields ?? []), ...settings];
}

/**
 * Paths inside an instance to `apiKey` and every secret field the rows declare. A path applies to
 * every instance that has the field, so a type's secret is masked without the config store
 * knowing which type declared it.
 */
export function instanceSecretPaths(rows: readonly LlmProviderTypeFacts[]): string[] {
  return [...new Set([...sharedSecretFields, ...rows.flatMap(rowSecretFields)])];
}

/** `llm.providers.*.<field>` for every path `instanceSecretPaths` names. */
export function providerSecretPaths(rows: readonly LlmProviderTypeFacts[]): string[] {
  return instanceSecretPaths(rows).map((field) => `llm.providers.*.${field}`);
}

/** Where a secret sits inside any instance, for restoring a draft's masked values. */
export const llmInstanceSecretPaths: readonly string[] = instanceSecretPaths(Object.values(llmProviderTypeTable));

/** The config paths that hold a provider secret, for the settings route to mask. */
export const llmProviderSecretPaths: readonly string[] = providerSecretPaths(Object.values(llmProviderTypeTable));
