import type {
  ModelTypeName,
  ObjectGenerationParams,
  Plugin,
  GenerateTextParams,
  TokenizeTextParams,
  DetokenizeTextParams,
} from "@elizaos/core";
import { ModelType, logger } from "@elizaos/core";
import { type TiktokenModel, encodingForModel } from "js-tiktoken";

const CLOUD_URL = process.env.NEXT_PUBLIC_ELIZA_CLOUD_URL || "http://localhost:3000";

function getModelName(model: ModelTypeName): TiktokenModel {
  const name =
    model === ModelType.TEXT_SMALL
      ? "llama-3.1-8b-instant"
      : "llama-3.3-70b-versatile";
  return name as TiktokenModel;
}

async function tokenizeText(model: ModelTypeName, prompt: string) {
  const encoding = encodingForModel(getModelName(model));
  return encoding.encode(prompt);
}

async function detokenizeText(model: ModelTypeName, tokens: number[]) {
  const encoding = encodingForModel(getModelName(model));
  return encoding.decode(tokens);
}

interface CloudMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CloudCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

async function generateCloudText(params: {
  model: string;
  prompt: string;
  system?: string;
  temperature: number;
  maxTokens: number;
}): Promise<string> {
  const messages: CloudMessage[] = [];

  if (params.system) {
    messages.push({ role: "system", content: params.system });
  }
  messages.push({ role: "user", content: params.prompt });

  const response = await fetch(`${CLOUD_URL}/api/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloud inference failed: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as CloudCompletionResponse;
  return data.choices[0]?.message?.content || "";
}

async function generateCloudObject(params: {
  model: string;
  prompt: string;
  temperature: number;
}): Promise<Record<string, unknown>> {
  const systemPrompt = "You are a helpful assistant that responds only with valid JSON objects. Do not include any text outside of the JSON object.";

  const response = await fetch(`${CLOUD_URL}/api/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: params.prompt },
      ],
      temperature: params.temperature,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloud inference failed: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as CloudCompletionResponse;
  const content = data.choices[0]?.message?.content || "{}";
  return JSON.parse(content) as Record<string, unknown>;
}

export const cloudInferencePlugin: Plugin = {
  name: "cloud-inference",
  description: "Cloud inference plugin using Eliza Cloud API",
  config: {
    ELIZA_CLOUD_URL: CLOUD_URL,
  },
  async init() {
    logger.info(`[CloudInference] Initialized with URL: ${CLOUD_URL}`);
  },
  models: {
    [ModelType.TEXT_TOKENIZER_ENCODE]: async (
      _runtime,
      { prompt, modelType = ModelType.TEXT_LARGE }: TokenizeTextParams,
    ) => {
      return await tokenizeText(modelType ?? ModelType.TEXT_LARGE, prompt);
    },
    [ModelType.TEXT_TOKENIZER_DECODE]: async (
      _runtime,
      { tokens, modelType = ModelType.TEXT_LARGE }: DetokenizeTextParams,
    ) => {
      return await detokenizeText(modelType ?? ModelType.TEXT_LARGE, tokens);
    },
    [ModelType.TEXT_SMALL]: async (
      runtime,
      { prompt, stopSequences = [] }: GenerateTextParams,
    ) => {
      const model =
        runtime.getSetting("CLOUD_SMALL_MODEL") ||
        runtime.getSetting("SMALL_MODEL") ||
        "llama-3.1-8b-instant";

      logger.log("[CloudInference] Generating text with TEXT_SMALL");

      return await generateCloudText({
        model,
        prompt,
        system: runtime.character.system ?? undefined,
        temperature: 0.7,
        maxTokens: 8000,
      });
    },
    [ModelType.TEXT_LARGE]: async (
      runtime,
      {
        prompt,
        stopSequences = [],
        maxTokens = 8192,
        temperature = 0.7,
      }: GenerateTextParams,
    ) => {
      const model =
        runtime.getSetting("CLOUD_LARGE_MODEL") ||
        runtime.getSetting("LARGE_MODEL") ||
        "llama-3.3-70b-versatile";

      logger.log("[CloudInference] Generating text with TEXT_LARGE");

      return await generateCloudText({
        model,
        prompt,
        system: runtime.character.system ?? undefined,
        temperature,
        maxTokens,
      });
    },
    [ModelType.OBJECT_SMALL]: async (
      runtime,
      params: ObjectGenerationParams,
    ) => {
      const model =
        runtime.getSetting("CLOUD_SMALL_MODEL") ||
        runtime.getSetting("SMALL_MODEL") ||
        "llama-3.1-8b-instant";

      logger.log("[CloudInference] Generating object with OBJECT_SMALL");

      return await generateCloudObject({
        model,
        prompt: params.prompt,
        temperature: params.temperature || 0.7,
      });
    },
    [ModelType.OBJECT_LARGE]: async (
      runtime,
      params: ObjectGenerationParams,
    ) => {
      const model =
        runtime.getSetting("CLOUD_LARGE_MODEL") ||
        runtime.getSetting("LARGE_MODEL") ||
        "llama-3.3-70b-versatile";

      logger.log("[CloudInference] Generating object with OBJECT_LARGE");

      return await generateCloudObject({
        model,
        prompt: params.prompt,
        temperature: params.temperature || 0.7,
      });
    },
  },
};

export default cloudInferencePlugin;


