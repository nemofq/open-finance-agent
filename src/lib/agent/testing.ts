import type { Agent } from "@earendil-works/pi-agent-core";
import { buildAgent, type CreateAgentOptions } from "./factory";

/** A built agent whose concerns have already run `beforeTurn`: the state a turn starts its run from. */
export async function createAgent(options: CreateAgentOptions): Promise<Agent> {
  const built = await buildAgent(options);
  await built.composed.beforeTurn(built.agent.state.messages);
  return built.agent;
}
