import React, { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";

import { PageEmbed } from "../components/PageRenderer";
import { PopupHost } from "../components/PopupHost";
import type { ScreenProps } from "../navigation";
import { colors } from "../theme";

// Standalone screen for a CMS page: navigation.navigate("Page", { slug, title }).
// The same <PageEmbed slug=… /> can be embedded inside ANY other screen too.
export function PageScreen({ route }: ScreenProps<"Page">) {
  const { slug } = route.params;
  // Captured from PageEmbed once the page loads, so popups can target this page.
  const [pageId, setPageId] = useState<string | null>(null);
  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <PageEmbed slug={slug} onLoad={(p) => setPageId(p.id)} />
      </ScrollView>
      {pageId && <PopupHost context={{ type: "page", pageId }} />}
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 24 },
});
