import React from "react";

/**
 * Caps the blast radius of a component that throws while rendering.
 *
 * ComponentRenderer renders a component with RAW props when schema validation
 * fails (see README), so a type-confused prop reaches component code that
 * expected the schema to have rejected it. Without a boundary React unmounts
 * the whole root and the entire app goes blank - transcript, composer and all -
 * because one block got a bad prop. Individual components still guard their own
 * props; this is the backstop for the ones that miss.
 */
interface Props {
  children: React.ReactNode;
  fallback: React.ReactNode;
}

export class GymErrorBoundary extends React.Component<Props, { failed: boolean }> {
  constructor(props: Props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[GymErrorBoundary] component threw while rendering", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
