/**
 * Development-only render tracking utility.
 * Tracks component renders and throws if a component renders too many times
 * in a short time window, indicating a render loop or performance issue.
 */

type RenderRecord = {
  count: number;
  timestamps: number[];
  lastProps?: Record<string, string>;
  lastState?: Record<string, string>;
};

const renderCounts = new Map<string, RenderRecord>();

// Configuration
const CONFIG = {
  /** Maximum renders allowed in the time window before throwing */
  maxRenders: 10,
  /** Time window in milliseconds to track renders */
  timeWindowMs: 1000,
  /** Enable verbose logging of every render */
  verboseLogging: false,
  /** Components to ignore (some are expected to render frequently) */
  ignoredComponents: new Set<string>([
    // Add component names here to ignore
  ]),
};

/**
 * Get a serializable summary of a value for debugging
 */
function summarizeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "function") return `fn:${value.name || "anonymous"}`;
  if (typeof value === "object") {
    if (Array.isArray(value)) return `array[${value.length}]`;
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    if (keys.length <= 3) return `{${keys.join(",")}}`;
    return `{${keys.slice(0, 3).join(",")}...+${keys.length - 3}}`;
  }
  if (typeof value === "string") {
    return value.length > 20 ? `"${value.slice(0, 20)}..."` : `"${value}"`;
  }
  return String(value);
}

/**
 * Get a props summary for debugging
 */
function getPropsSnapshot(props: Record<string, unknown>): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "children") {
      snapshot[key] = typeof value === "object" ? "ReactNode" : String(value);
    } else {
      snapshot[key] = summarizeValue(value);
    }
  }
  return snapshot;
}

/**
 * Find what changed between two snapshots
 */
function findChanges(
  prev: Record<string, string> | undefined,
  curr: Record<string, string>
): string[] {
  if (!prev) return ["(first render)"];
  const changes: string[] = [];
  
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
  for (const key of allKeys) {
    if (prev[key] !== curr[key]) {
      changes.push(`${key}: ${prev[key]} → ${curr[key]}`);
    }
  }
  
  return changes.length > 0 ? changes : ["(no prop changes detected)"];
}

/**
 * Track a component render. Call this at the top of your component.
 * In development, throws an error if the component renders excessively.
 * 
 * @param componentName - Unique identifier for the component
 * @param props - Component props (optional, for debugging)
 * @param state - Component state snapshot (optional, for debugging)
 * 
 * @example
 * ```tsx
 * function MyComponent(props: MyProps) {
 *   useRenderTracker("MyComponent", props);
 *   // ... rest of component
 * }
 * ```
 */
export function trackRender(
  componentName: string,
  props?: Record<string, unknown>,
  state?: Record<string, unknown>
): void {
  // Only run in development
  if (process.env.NODE_ENV !== "development") return;
  
  // Skip ignored components
  if (CONFIG.ignoredComponents.has(componentName)) return;
  
  const now = Date.now();
  let record = renderCounts.get(componentName);
  
  if (!record) {
    record = { count: 0, timestamps: [] };
    renderCounts.set(componentName, record);
  }
  
  // Clean up old timestamps outside the window
  record.timestamps = record.timestamps.filter(
    (ts) => now - ts < CONFIG.timeWindowMs
  );
  
  // Add current timestamp
  record.timestamps.push(now);
  record.count++;
  
  // Get current snapshots
  const propsSnapshot = props ? getPropsSnapshot(props) : undefined;
  const stateSnapshot = state ? getPropsSnapshot(state) : undefined;
  
  // Check for excessive renders
  const recentRenders = record.timestamps.length;
  
  if (CONFIG.verboseLogging) {
    const propsChanges = propsSnapshot ? findChanges(record.lastProps, propsSnapshot) : [];
    const stateChanges = stateSnapshot ? findChanges(record.lastState, stateSnapshot) : [];
    console.log(
      `[RenderTracker] ${componentName} render #${record.count} (${recentRenders} in ${CONFIG.timeWindowMs}ms)`,
      { propsChanges, stateChanges }
    );
  }
  
  if (recentRenders > CONFIG.maxRenders) {
    const propsChanges = propsSnapshot ? findChanges(record.lastProps, propsSnapshot) : [];
    const stateChanges = stateSnapshot ? findChanges(record.lastState, stateSnapshot) : [];
    
    const error = new Error(
      `[RenderTracker] EXCESSIVE RENDERS DETECTED: ${componentName} rendered ${recentRenders} times in ${CONFIG.timeWindowMs}ms.\n\n` +
      `This indicates a render loop or severe performance issue.\n\n` +
      `Recent prop changes: ${propsChanges.join(", ")}\n` +
      `Recent state changes: ${stateChanges.join(", ")}\n\n` +
      `Common causes:\n` +
      `  1. Object/array created in render passed as prop (use useMemo)\n` +
      `  2. Callback created in render passed as prop (use useCallback)\n` +
      `  3. State update in useEffect without proper deps\n` +
      `  4. Context value changing on every render\n` +
      `  5. Missing dependency in useEffect causing infinite loop`
    );
    
    // Log detailed info before throwing
    console.error(error.message);
    console.error("Component:", componentName);
    console.error("Props snapshot:", propsSnapshot);
    console.error("State snapshot:", stateSnapshot);
    console.error("Render timestamps:", record.timestamps.map(ts => new Date(ts).toISOString()));
    
    throw error;
  }
  
  // Update snapshots for next comparison
  record.lastProps = propsSnapshot;
  record.lastState = stateSnapshot;
}

/**
 * React hook version of trackRender for easier integration.
 * 
 * @example
 * ```tsx
 * function MyComponent(props: MyProps) {
 *   useRenderTracker("MyComponent", props);
 *   const [state, setState] = useState({});
 *   // ... rest of component
 * }
 * ```
 */
export function useRenderTracker(
  componentName: string,
  props?: Record<string, unknown>,
  state?: Record<string, unknown>
): void {
  trackRender(componentName, props, state);
}

/**
 * Reset tracking for a specific component (useful for testing)
 */
export function resetRenderTracking(componentName?: string): void {
  if (componentName) {
    renderCounts.delete(componentName);
  } else {
    renderCounts.clear();
  }
}

/**
 * Get current render stats for debugging
 */
export function getRenderStats(): Map<string, { count: number; recentCount: number }> {
  const now = Date.now();
  const stats = new Map<string, { count: number; recentCount: number }>();
  
  for (const [name, record] of renderCounts) {
    const recentTimestamps = record.timestamps.filter(
      (ts) => now - ts < CONFIG.timeWindowMs
    );
    stats.set(name, {
      count: record.count,
      recentCount: recentTimestamps.length,
    });
  }
  
  return stats;
}

/**
 * Log all render stats to console
 */
export function logRenderStats(): void {
  if (process.env.NODE_ENV !== "development") return;
  
  const stats = getRenderStats();
  console.group("[RenderTracker] Render Statistics");
  
  const sorted = [...stats.entries()].sort(
    (a, b) => b[1].recentCount - a[1].recentCount
  );
  
  for (const [name, { count, recentCount }] of sorted) {
    const status = recentCount > 5 ? "⚠️" : recentCount > 2 ? "📈" : "✅";
    console.log(`${status} ${name}: ${count} total, ${recentCount} recent`);
  }
  
  console.groupEnd();
}

/**
 * Configure the render tracker
 */
export function configureRenderTracker(options: Partial<typeof CONFIG>): void {
  Object.assign(CONFIG, options);
}

// Export config for external access
export { CONFIG as RENDER_TRACKER_CONFIG };

