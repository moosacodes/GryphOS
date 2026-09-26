import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAppData } from "./hooks/useStore";
import { useTheme } from "./hooks/useTheme";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { CalendarPage } from "./pages/CalendarPage";
import { CoursesPage } from "./pages/CoursesPage";
import { CourseDetailPage } from "./pages/CourseDetailPage";
import { GradesPage } from "./pages/GradesPage";
import { TasksPage } from "./pages/TasksPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ChangesPage } from "./pages/ChangesPage";

export function App() {
  const { data, ready, update } = useAppData();
  useTheme(data.preferences.theme);

  if (!ready) {
    return (
      <div style={{ padding: "2rem", color: "var(--text-muted)" }}>
        Loading gryphOS…
      </div>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout data={data} />}>
          <Route index element={<Dashboard data={data} update={update} />} />
          <Route path="calendar" element={<CalendarPage data={data} />} />
          <Route path="courses" element={<CoursesPage data={data} />} />
          <Route path="courses/:courseId" element={<CourseDetailPage data={data} />} />
          <Route path="grades" element={<GradesPage data={data} update={update} />} />
          <Route path="tasks" element={<TasksPage data={data} />} />
          <Route path="changes" element={<ChangesPage data={data} update={update} />} />
          <Route path="documents" element={<DocumentsPage data={data} update={update} />} />
          <Route path="settings" element={<SettingsPage data={data} update={update} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
