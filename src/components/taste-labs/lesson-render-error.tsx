export function LessonRenderError({ name }: { name?: string }) {
  return (
    <div className="tasteMissing" role="alert">
      <strong className="tasteDisplay">Could not render</strong>
      <span>
        {name
          ? `“${name}” is not in the fixture-only component registry.`
          : "The component block did not match a registered fixture view."}
      </span>
    </div>
  );
}
