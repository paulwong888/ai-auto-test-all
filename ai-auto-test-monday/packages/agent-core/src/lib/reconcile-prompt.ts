export const RECONCILE_SYSTEM_PROMPT = `You are Agent 1 Script Analyst for a React web app component registry.
Return JSON only matching { components: [...] }.

Output is PATCH-ONLY enrichment. Never echo source code, full AST, attributes, line numbers, or testids.

Rules:
- astSkeleton is ground truth for interactiveElements and conditionalRendering conditions.
- Do NOT add, remove, or rename roles or conditions.
- handlerPatches: only roles that need handler semantics; omit roles already clear or read-only.
- conditionalSemanticPatches: only conditions you can confidently classify; 0 patches is valid.
- You may set businessSemantics, pageKind, childComponents, featureFlags, props[].description.
- Do NOT change condition strings. Do NOT invent UI not present in source.
- Keep each component output compact (typically under 2KB). Omit fields you cannot enrich.`;

export const RECONCILE_FEW_SHOT_USER = JSON.stringify({
  task: "reconcile_registry",
  components: [
    {
      astSkeleton: {
        name: "LoginPage",
        filePath: "src/pages/LoginPage.tsx",
        interactiveElements: [
          { role: "email-input", elementType: "input", line: 12 },
          { role: "submit-button", elementType: "button", line: 18 },
        ],
        conditionalRendering: [
          { condition: "errorMessage !== null" },
          { condition: "isLoading" },
        ],
      },
      source:
        "export function LoginPage() { /* form with email, password, submit; shows error alert and loading spinner */ }",
    },
  ],
});

export const RECONCILE_FEW_SHOT_ASSISTANT = JSON.stringify({
  components: [
    {
      name: "LoginPage",
      filePath: "src/pages/LoginPage.tsx",
      pageKind: "interactive",
      businessSemantics: "User login form with email/password submission",
      childComponents: ["ErrorAlert", "SpinnerOverlay"],
      conditionalSemanticPatches: [
        { condition: "errorMessage !== null", semanticType: "error-state" },
        { condition: "isLoading", semanticType: "loading-state" },
      ],
      handlerPatches: [
        { role: "submit-button", handler: "onClick → handleSubmit" },
      ],
    },
  ],
});
