import { useEffect } from 'react';
import { useAppState } from './store/appStore';
import { useAuth } from './context/AuthContext';
import Header from './components/Header';
import UpgradeModal from './components/UpgradeModal';
import { ToastStack } from './components/Toast';
import IntakeScreen from './screens/IntakeScreen';
import ProcessingScreen from './screens/ProcessingScreen';
import EditorScreen from './screens/EditorScreen';
import AuthScreen from './screens/AuthScreen';

export default function App() {
  const app = useAppState();
  const { state } = app;
  const auth = useAuth();

  // Sync auth user identity into the app store whenever auth changes.
  useEffect(() => {
    app.setAuthUser(auth.user);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user]);

  useEffect(() => {
    app.closeAccountDropdown();
  }, [state.screen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show full-screen auth gate when not authenticated (and not still loading).
  if (!auth.isLoading && !auth.isAuthenticated) {
    return (
      <>
        {/* Blurred dashboard silhouette behind auth overlay */}
        <div className="min-h-screen bg-[#0B0F17] text-white font-sans select-none pointer-events-none">
          <div className="filter blur-md opacity-30 saturate-50">
            <Header
              state={state}
              onOpenUpgradeModal={() => {}}
              onToggleAccountDropdown={() => {}}
              onCloseAccountDropdown={() => {}}
              onNavigateHome={() => {}}
              onLogout={() => {}}
            />
            <div className="min-h-screen flex items-center justify-center pt-16">
              <div className="max-w-2xl mx-auto px-6 text-center space-y-6">
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-sky-500/30 to-cyan-400/30 mx-auto" />
                <div className="h-8 bg-white/5 rounded-xl w-3/4 mx-auto" />
                <div className="h-4 bg-white/5 rounded-lg w-1/2 mx-auto" />
                <div className="h-12 bg-sky-500/10 rounded-xl w-48 mx-auto" />
              </div>
            </div>
          </div>
        </div>
        <AuthScreen
          onSuccess={(name) => {
            app.addToast({
              type: 'success',
              title: `Welcome, ${name.split(' ')[0]}!`,
              message: 'Your workspace is ready. Drop a video to get started.',
            });
          }}
        />
      </>
    );
  }

  // Loading spinner while Supabase session hydrates
  if (auth.isLoading) {
    return (
      <div className="min-h-screen bg-[#0B0F17] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-sky-500/30 border-t-sky-400 rounded-full animate-spin" />
          <p className="text-slate-500 text-sm">Loading workspace…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white font-sans">
      <Header
        state={state}
        onOpenUpgradeModal={app.openUpgradeModal}
        onToggleAccountDropdown={app.toggleAccountDropdown}
        onCloseAccountDropdown={app.closeAccountDropdown}
        onNavigateHome={() => app.setScreen('intake')}
        onLogout={auth.logout}
      />

      {state.screen === 'intake' && (
        <IntakeScreen
          state={state}
          onGenerate={app.runPipeline}
          onSetUrl={app.setInputUrl}
          onSetDragging={app.setIsDragging}
          onSetFile={app.setUploadedFile}
          onOpenUpgrade={app.openUpgradeModal}
        />
      )}

      {state.screen === 'processing' && (
        <ProcessingScreen
          pipeline={state.pipeline}
          pipelineError={state.pipelineError}
        />
      )}

      {state.screen === 'editor' && (
        <EditorScreen
          state={state}
          onSetClip={app.setActiveClipIndex}
          onSetPreset={app.setSubtitlePreset}
          onSetActiveWord={app.setActiveWordIndex}
          onAddToQueue={app.addToPublishQueue}
          onRemoveFromQueue={app.removeFromPublishQueue}
          onUpdateTitle={app.updateMetadataTitle}
        />
      )}

      {state.isUpgradeModalOpen && (
        <UpgradeModal
          currentPlan={state.user.plan}
          onClose={app.closeUpgradeModal}
          onSelectPlan={app.selectPlan}
          onPurchasePlan={app.purchasePlan}
        />
      )}

      <ToastStack toasts={state.toasts} onDismiss={app.dismissToast} />
    </div>
  );
}
