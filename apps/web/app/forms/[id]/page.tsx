import FormEmbed from "@/components/FormEmbed";

// Standalone public page for a single form (direct link / testing). The same
// <FormEmbed formId=… /> can be embedded in any page or popup.
export const dynamic = "force-dynamic";

export default function FormPage({ params }: { params: { id: string } }) {
  return (
    <div className="dark-page">
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "0 20px" }}>
        <div className="ik-panel">
          <FormEmbed formId={params.id} />
        </div>
      </div>
    </div>
  );
}
