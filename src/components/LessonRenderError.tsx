export function LessonRenderError({ name }: { name?: string }) {
  return (
    <div className="wrap">
      <div className="missing">
        <strong className="display">Could not render</strong>
        <span>
          {name
            ? `Component “${name}” is not in the lesson registry.`
            : "The component block did not match a registered view."}
        </span>
      </div>
    </div>
  );
}
