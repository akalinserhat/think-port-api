/**
 * Akalin UI - Modern, Standalone UI Component Library
 * Design system, base pages, components, alerts, context, and utilities.
 */

// 1. Base Pages & Layouts
export { default as BasePage, type BasePageProps } from './pages/base/BasePage';
export { default as BaseSystemPage, BaseSystemPageContext, useBaseSystemPage, type BaseSystemPageProps, type BaseSystemPageContextValue, type BaseSystemPageSearchField, type SystemSettingModule } from './pages/base/BaseSystemPage';
export { default as BaseListPage, type BaseListPageProps } from './pages/base/BaseListPage';
export { default as BaseCardPage, type BaseCardPageProps } from './pages/base/BaseCardPage';
export { default as BaseFormPage, type BaseFormPageProps, type FormComponentProps } from './pages/base/BaseFormPage';
export { default as BaseDocumentPage, DocumentHeaderPanel, DocumentHeaderField, DocumentFormContext, DocumentHeaderFieldContext, type BaseDocumentPageProps, type DocumentHeaderPanelProps, type DocumentHeaderFieldProps, type DocumentCurrencyProps } from './pages/base/BaseDocumentPage';
export { default as BaseWizardPage, WizardStep, type BaseWizardPageProps, type WizardStepProps } from './pages/base/BaseWizardPage';
export { default as BaseSelectionList, type BaseSelectionListProps } from './pages/base/BaseSelectionList';
export { default as BasePopup, type BasePopupProps } from './pages/base/BasePopup';
export { default as BaseCrudPopup } from './pages/base/BaseCrudPopup';
export { default as BaseModalCrud, type BaseModalCrudProps } from './pages/base/BaseModalCrud';
export { default as BaseSeciciModal, type BaseSeciciModalProps } from './pages/base/BaseSeciciModal';
export { default as Modal, type ModalProps } from './pages/base/Modal';
export { default as BaseListAiModal, type BaseListAiModalProps } from './pages/base/BaseListAiModal';
export { default as BaseChatPage, BaseAiChatPage, type BaseChatPageProps, type ChatMessage, type ChatSession, type ChatAgent, type ChatAttachment, type PromptSuggestion } from './pages/base/BaseChatPage';
export { default as BasePromptDialog, type BasePromptDialogProps } from './alerts/BasePromptDialog';

// 2. Base Components
export { default as BaseInput, type BaseInputProps, HarfDonusumu, type TextCasing, applyCasing, InputSettingsContext, InputSettingsProvider, useInputSettings, type InputSettingsContextType } from './components/base/input/BaseInput';
export { default as BaseNumericInput, type BaseNumericInputProps } from './components/base/input/BaseNumericInput';
export { BaseListInput, type BaseListInputProps, type Column as BaseListInputColumn } from './components/base/input/BaseListInput';
export { default as BaseSeciciInput, type BaseSeciciInputProps } from './components/base/input/BaseSeciciInput';
export { default as BaseTreeDropdownSecici, type BaseTreeDropdownSeciciProps, type TreeDropdownNode } from './components/base/input/BaseTreeDropdownSecici';
export { default as BaseButton, type BaseButtonProps } from './components/base/button/BaseButton';
export { default as BaseFloatCircleButton, type BaseFloatCircleButtonProps } from './components/base/button/BaseFloatCircleButton';
export { default as BaseMenuButton, type BaseMenuButtonProps, type MenuButtonItem } from './components/base/button/BaseMenuButton';
export { BaseCard, type BaseCardProps, type CardVariant } from './components/base/card';
export { default as BaseDashboardView, type BaseDashboardViewProps } from './components/base/view/BaseDashboardView';
export { 
  DashboardStatCard, 
  type DashboardStatCardProps,
  DashboardTimelineChartView, 
  type DashboardTimelineChartViewProps, 
  type DashboardTimelineChartSeries,
  DashboardDistributionView, 
  type DashboardDistributionViewProps, 
  type DashboardDistributionItem,
  DashboardActivityFeedView, 
  type DashboardActivityFeedViewProps, 
  type DashboardActivityEvent 
} from './components/dashboard';
export { default as BaseProgressBar, type BaseProgressBarProps } from './components/base/progress/BaseProgressBar';
export { BaseSwitch, type BaseSwitchProps } from './components/base/switch';
export { BaseTreeView, type BaseTreeViewProps, type TreeItem } from './components/base/treeview/BaseTreeView';
export { default as BaseTreeTableView, type BaseTreeTableViewProps, type BaseTreeTableItem } from './components/base/treeview/BaseTreeTableView';
export { default as BaseDropdownSecici, type BaseDropdownSeciciProps, type DropdownOption } from './components/base/list/BaseDropdownSecici';
export { default as BaseObjectList, type BaseObjectListProps, type ObjectListLayout } from './components/base/list/BaseObjectList';
export { default as BaseBarkodOkuyucu, type BaseBarkodOkuyucuProps } from './components/base/scanner/BaseBarkodOkuyucu';

// 3. Cards
export { default as Card } from './components/card/Card';
export { default as BaseCardPageHeader, default as CardPageHeader, type BaseCardPageHeaderProps, type BaseCardPageHeaderProps as CardPageHeaderProps } from './components/card/BaseCardPageHeader';
export { 
  default as BaseSystemCard, 
  default as SystemModuleCard, 
  default as SystemCard,
  type BaseSystemCardProps,
  type BaseSystemCardDetailItem,
  type BaseSystemCardStatus,
  type BaseSystemCardBorderHighlight,
  type BaseSystemCardIconBoxVariant
} from './components/card/BaseSystemCard';
export { default as PolicySettingCard, default as AyarCard, type PolicySettingCardProps, type PolicySettingCardProps as AyarCardProps } from './components/card/PolicySettingCard';
export { default as NotificationCard, type NotificationCardProps, type NotificationType, type NotificationAction } from './components/card/NotificationCard';
export { default as AdminNotificationCard, type AdminNotificationCardProps, type AdminNotificationAction, type AdminNotificationSeverity, type AdminNotificationCategory } from './components/card/AdminNotificationCard';
export { default as SistemKart, type SistemKartProps } from './components/card/SistemKart';
export { default as UserCard, type UserCardProps, type UserCardItem } from './components/card/UserCard';
export { default as EmailTemplateCard, type EmailTemplateCardProps } from './components/card/EmailTemplateCard';
export { default as BulutDepolamaCard, type BulutDepolamaCardProps, type BulutDepolamaItem } from './components/card/BulutDepolamaCard';
export { default as MigrationFieldCard, default as MigrationOptionCard, type MigrationFieldCardProps, type MigrationOptionCardProps } from './components/card/MigrationFieldCard';

// 4. Tables, Grids, Lists, Tabs, Menus & Tree Views
export { default as DataTable, type DataTableProps, type Column, type Column as DataTableColumn, type FetchDataArgs } from './components/grid/DataTable';
export { default as SpreadsheetGrid, type SpreadsheetGridProps, type SpreadsheetSettingsColumnPosition } from './components/grid/spreadsheet/SpreadsheetGrid';
export { default as CardList, type CardListProps } from './components/list/CardList';
export { default as TabLayout, type TabLayoutProps, type BaseTabItem } from './components/tab/TabLayout';
export { default as Breadcrumb, type BreadcrumbProps, type BreadcrumbItem } from './components/breadcrumb/Breadcrumb';
export { default as ActionMenu, type ActionMenuProps, type ActionMenuItem, type ActionMenuButtonVariant } from './components/menu/ActionMenu';
export { default as DrawerMenu, type DrawerMenuProps, type DrawerUser, type DrawerMenuItem } from './components/menu/DrawerMenu';
export { default as Sidebar, type SidebarProps, type SidebarItem, type SidebarBadge, type FlyoutState } from './components/sidebar';
export { SidebarFlyout, type SidebarFlyoutProps } from './components/sidebar/SidebarFlyout';
export { CloudDirectoryView, type CloudDirectoryViewProps, type CloudFolderItem } from './components/treeview/CloudDirectoryView';
export { 
  default as TreeTableView, 
  FaaliyetAlanlariTreeView, 
  type TreeTableViewProps, 
  type FaaliyetAlanlariTreeViewProps, 
  type TreeTableItem, 
  type FaaliyetAlaniItem, 
  type FeaturePresetOption, 
  DEFAULT_FEATURE_PRESETS 
} from './components/treeview/TreeTableView';

// 5. Inputs & Buttons
export { default as BasitInput, type BasitInputProps } from './components/input/BasitInput';
export { default as AramaInput, type AramaInputProps } from './components/input/AramaInput';
export { default as TamsayiInput, type TamsayiInputProps } from './components/input/TamsayiInput';
export { default as YuzdelikInput, type YuzdelikInputProps } from './components/input/YuzdelikInput';
export { default as NotInput, type NotInputProps } from './components/input/NotInput';
export { default as DateInput, type DateInputProps } from './components/input/DateInput';
export { default as DateRangeInput, TarihAraligiSecici, type DateRangeInputProps, type TarihAraligiSeciciProps } from './components/input/DateRangeInput';
export { default as PhoneInput, type PhoneInputProps, formatPhoneNumber, validatePhoneNumber } from './components/input/PhoneInput';
export { default as EmailInput, type EmailInputProps } from './components/input/EmailInput';
export { default as EpostaSeciciInput, epostaSeciciInput, type EpostaSeciciInputProps, EMAIL_FORMAT_REGEX, isValidEmailAddress } from './components/input/EpostaSeciciInput';
export { default as CurrencyInput, type CurrencyInputProps } from './components/input/CurrencyInput';
export { default as BarcodeScannerInput, type BarcodeScannerInputProps, canOpenBarcodeScanner } from './components/input/BarcodeScannerInput';
export { default as IbanInput, type IbanInputProps, validateIBAN, formatIBAN } from './components/input/IbanInput';
export { default as AnahtarOlusturucuInput, ApiKeyInput, type AnahtarOlusturucuInputProps, type ApiKeyInputProps, generateRandomApiKey } from './components/input/AnahtarOlusturucuInput';
export { default as SaveButton } from './components/button/SaveButton';
export { default as DocumentSaveButton, type DocumentSaveButtonProps } from './components/button/DocumentSaveButton';
export { default as CancelButton } from './components/button/CancelButton';
export { default as BackButton, type BackButtonProps } from './components/button/BackButton';
export { default as OkButton, type OkButtonProps } from './components/button/OkButton';
export { default as NextButton, type NextButtonProps } from './components/button/NextButton';
export { default as PrevButton, type PrevButtonProps } from './components/button/PrevButton';
export { default as FinishButton, type FinishButtonProps } from './components/button/FinishButton';
export { default as UploadButton } from './components/button/UploadButton';
export { default as EkleMenuButton, type EkleMenuButtonProps } from './components/button/EkleMenuButton';
export { default as EkleFloatCircleButton, type EkleFloatCircleButtonProps } from './components/button/EkleFloatCircleButton';
export { default as TumunuOkunduIsaretleButton, type TumunuOkunduIsaretleButtonProps } from './components/button/TumunuOkunduIsaretleButton';
export { default as TumunuTemizleButton, type TumunuTemizleButtonProps } from './components/button/TumunuTemizleButton';

// 6. Views, Editors, Dialogs, Modals, Progress & AI
export { default as HtmlEditor, type HtmlEditorProps, type HtmlEditorTemplate } from './components/editor/HtmlEditor';
export { 
  default as TemplateBuilder, 
  type TemplateBuilderProps, 
  type TemplateTagGroup, 
  type TemplateBlock,
  type CasingOption,
  TEMPLATE_CASING_OPTIONS,
  parseTagContent,
  buildTagText,
  replaceTemplateTag
} from './components/customs/panel/TemplateBuilder';
export { default as TutarView, type TutarViewProps } from './components/customs/view/TutarView';
export { default as PhoneView, type PhoneViewProps } from './components/customs/view/PhoneView';
export { default as IbanView, type IbanViewProps } from './components/customs/view/IbanView';
export { default as ParaBirimiView, type ParaBirimiViewProps } from './components/customs/view/ParaBirimiView';
export { default as CurrencyIcon, type CurrencyIconProps } from './components/customs/view/CurrencyIcon';
export { default as BaseDetailDialog } from './components/dialog/BaseDetailDialog';
export { default as AlertDialog, type AlertDialogProps } from './components/dialog/AlertDialog';
export { default as FileUploadProgressBar, type FileUploadProgressBarProps } from './components/progress/FileUploadProgressBar';
export { default as StorageQuotaBar, type StorageQuotaBarProps } from './components/progress/StorageQuotaBar';
export { default as AiTypingIndicator, type AiTypingIndicatorProps } from './components/progress/AiTypingIndicator';
export { default as AiResponseTimer, type AiResponseTimerProps } from './components/progress/AiResponseTimer';
export { default as AiThinkingDetails, type AiThinkingDetailsProps } from './components/progress/AiThinkingDetails';
export { default as SyncProgressModal, type SyncProgressModalProps, type SyncReport, type SyncProgressData } from './components/progress/SyncProgressModal';
export { default as PageLoader, type PageLoaderProps } from './components/progress/PageLoader';
export { default as ErrorBoundary, type ErrorBoundaryProps } from './components/common/ErrorBoundary';
export { default as FieldError, type FieldErrorProps } from './components/common/FieldError';
export { default as UndoDeleteBar, type UndoDeleteBarProps } from './components/notification/UndoDeleteBar';
export { default as FilesOnClouds, type FilesOnCloudsProps, type FilesOnCloudsHandle, registerCloudFilesComponent, getCloudFilesComponent } from './components/customs/cloud/FilesOnClouds';
export { default as UploadToCloud, type UploadToCloudProps, registerUploadToCloudComponent, getUploadToCloudComponent } from './components/customs/cloud/UploadToCloud';
export { default as BarcodeScannerModal, type BarcodeScannerModalProps } from './components/modal/BarcodeScannerModal';
export { default as LLMSeciciInput, type LLMSeciciInputProps, type LLMSaglayiciOption } from './components/customs/select/LLMSeciciInput';
export { default as YZModelSecici, type YZModelSeciciProps, type YZModelOption } from './components/customs/select/YZModelSecici';
export { default as BaseAiAssistantModal, type BaseAiAssistantModalProps } from './components/modal/BaseAiAssistantModal';

// 7. Alerts, Context & Utils
export { default as AlertDialogContext, AlertDialogProvider, useAlertDialog, type AlertDialogContextType } from './alerts/AlertDialogContext';
export { HeaderProvider, useHeader, useHeaderApi, useDocumentDirty, type HeaderContextType } from './context/HeaderContext';
export { createSingletonContext } from './utils/createSingletonContext';
export { formatCurrency } from './utils/formatters';
export { extractTextFromNode, updateDocumentTitle, autoFocusFirstInput } from './utils/domUtils';
export { isNativePlatform, isMobileBrowser, isMobileDevice } from './utils/device';
