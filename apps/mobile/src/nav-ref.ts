// Module-level navigation ref so non-component code (the href resolver) can
// navigate. Kept dependency-free to avoid import cycles.
import { createNavigationContainerRef } from "@react-navigation/native";

import type { RootStackParamList } from "./navigation";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();
