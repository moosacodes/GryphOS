import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAppData } from "./hooks/useStore";
import { useTheme } from "./hooks/useTheme";
import { Layout } from "./components/Layout";
import { TodayPage } from "./pages/TodayPage";
import { AssessmentDetailPage } from "./pages/AssessmentDetailPage";
import { CalendarPage } from "./pages/CalendarPage";
import { CoursesPage } from "./pages/CoursesPage";
import { CourseDetailPage } from "./pages/CourseDetailPage";
import { GradesPage } from "./pages/GradesPage";
import { TasksPage } from "./pages/TasksPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { InboxPage } from "./pages/InboxPage";
import { SearchPage } from "./pages/SearchPage";
import { SetupPage } from "./pages/SetupPage";
import { CoveragePage } from "./pages/CoveragePage";

export function App() {
  const { data, ready, update } = useAppData();
  useTheme(data.preferences.theme);

  if (!ready) {
    return (
      <div className="boot-screen" style={{ padding: "2rem", color: "var(--text-muted)" }}>
        Loading gryphOS...
      </div>
    );
  }

  const needsSetup =
    !data.sync.lastSyncedAt ||
    !(data.preferences.selectedCourseIds && data.preferences.selectedCourseIds.length);

  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout data={data} update={update} />}>
          <Route index element={<TodayPage data={data} update={update} />} />
          <Route path="inbox" element={<InboxPage data={data} update={update} />} />
          <Route path="assessment/:id" element={<AssessmentDetailPage data={data} update={update} />} />
          <Route path="calendar" element={<CalendarPage data={data} />} />
          <Route path="courses" element={<CoursesPage data={data} />} />
          <Route path="courses/:courseId" element={<CourseDetailPage data={data} />} />
          <Route path="grades" element={<GradesPage data={data} update={update} />} />
          <Route path="tasks" element={<TasksPage data={data} />} />
          <Route path="search" element={<SearchPage data={data} />} />
          <Route path="coverage" element={<CoveragePage data={data} />} />
          <Route path="coverage/:courseId" element={<CoveragePage data={data} />} />
          <Route path="setup" element={<SetupPage data={data} update={update} />} />
          <Route path="documents" element={<DocumentsPage data={data} update={update} />} />
          <Route path="settings" element={<SettingsPage data={data} update={update} />} />
          <Route path="changes" element={<Navigate to="/inbox" replace />} />
          <Route path="*" element={<Navigate to={needsSetup ? "/setup" : "/"} replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

