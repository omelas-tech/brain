/**
 * Renders a JSON-LD structured-data <script> tag.
 *
 * Server component — safe to use in layouts and pages. The payload is
 * serialized once at render time. We escape `<` to prevent the closing
 * `</script>` sequence from ever appearing inside the JSON string.
 */
export default function JsonLd({ data }: { data: object }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
