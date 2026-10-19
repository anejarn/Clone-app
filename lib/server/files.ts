import "server-only";

/**
 * A private file as a response (statements, owner documents): never cached, never indexed. Images are sandboxed;
 * PDFs are not (a sandbox CSP stops the browsers' PDF viewers; these PDFs are drawn by Sigma or uploaded by its
 * associés). `inline` opens it in the browser's viewer, else it downloads. The name is made ASCII here.
 */
export function privateFileResponse(bytes: Uint8Array, contentType: string, filename: string, inline = true): Response {
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": "private, no-store, max-age=0",
      ...(contentType !== "application/pdf" && { "Content-Security-Policy": "default-src 'none'; sandbox" }),
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
