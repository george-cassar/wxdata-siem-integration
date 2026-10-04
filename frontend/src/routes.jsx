import React, { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Loading } from '@carbon/react';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const QueryStudioPage = lazy(() => import('./pages/QueryStudioPage'));
const OffensesPage = lazy(() => import('./pages/OffensesPage'));
const CompliancePage = lazy(() => import('./pages/CompliancePage'));
const ArchitecturePage = lazy(() => import('./pages/ArchitecturePage'));

export default function AppRoutes() {
  return (
    <Suspense fallback={<Loading description="Loading page..." withOverlay={true} />}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/query-studio" element={<QueryStudioPage />} />
        <Route path="/offenses" element={<OffensesPage />} />
        <Route path="/compliance" element={<CompliancePage />} />
        <Route path="/architecture" element={<ArchitecturePage />} />
      </Routes>
    </Suspense>
  );
}
