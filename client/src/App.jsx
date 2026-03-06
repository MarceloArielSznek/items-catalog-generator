import { BrowserRouter, Routes, Route } from "react-router-dom";
import Header from "./components/Header.jsx";
import SceneManagerPage from "./pages/SceneManagerPage.jsx";
import GeneratorPage from "./pages/GeneratorPage.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Header />
        <Routes>
          <Route path="/" element={<SceneManagerPage />} />
          <Route path="/generate/:sceneId" element={<GeneratorPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
