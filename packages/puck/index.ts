// Shared Puck configuration for the LMS page builder. Consumed as source by the
// admin editor (<Puck>) and the public web renderer (<Render>) — see
// transpilePackages in each app's next.config.js.
export { createPuckConfig } from "./config";
export type { PuckConfigOptions, PageProps, RootProps, DesignProps } from "./config";
