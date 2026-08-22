import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { LessonApp } from "@/components/LessonApp";
import "@/styles/riso.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <div className="grain" aria-hidden="true" />
      <Routes>
        <Route path="/" element={<LessonApp mode="workflow" />} />
        <Route path="/demo" element={<LessonApp mode="demo" />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
