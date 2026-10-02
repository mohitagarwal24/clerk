// OpenTelemetry spans for run / step / LLM call / tool call, exported to a local Arize Phoenix
// when CLERK_TRACING=1. Without it the OTel API is a no-op, so the engine never depends on Phoenix.
import { context, trace, SpanStatusCode, type Attributes, type Span } from "@opentelemetry/api";
import { config } from "./config.js";

let registered = false;

export async function initTelemetry() {
  if (!config.tracing || registered) return;
  registered = true;
  const { register } = await import("@arizeai/phoenix-otel");
  register({ projectName: "clerk", url: config.phoenixUrl, batch: false });
}

const tracer = () => trace.getTracer("clerk");

/** OpenInference span kinds, so Phoenix renders agent, LLM and tool spans properly. */
export type SpanKind = "AGENT" | "CHAIN" | "LLM" | "TOOL" | "EVALUATOR";

export async function span<T>(name: string, kind: SpanKind, attrs: Attributes, fn: (s: Span) => Promise<T>): Promise<T> {
  return tracer().startActiveSpan(name, { attributes: { "openinference.span.kind": kind, ...attrs } }, async (s) => {
    try {
      const out = await fn(s);
      s.setStatus({ code: SpanStatusCode.OK });
      return out;
    } catch (e) {
      s.recordException(e as Error);
      s.setStatus({ code: SpanStatusCode.ERROR, message: (e as Error).message });
      throw e;
    } finally {
      s.end();
    }
  });
}

export function currentTraceId(): string | undefined {
  const id = trace.getSpan(context.active())?.spanContext().traceId;
  return id && !/^0+$/.test(id) ? id : undefined;
}

export function traceUrl(traceId: string | undefined): string | undefined {
  return config.tracing && traceId ? `${config.phoenixUrl}/projects?traceId=${traceId}` : undefined;
}

/** Cap long strings on span attributes. */
export const clip = (s: string, n = 4000) => (s.length > n ? `${s.slice(0, n)}…[+${s.length - n}]` : s);
