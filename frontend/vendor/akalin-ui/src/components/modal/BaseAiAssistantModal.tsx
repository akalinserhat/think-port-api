import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { 
    Sparkles, 
    Bot, 
    CheckCircle2, 
    RefreshCw, 
    Calendar, 
    Cloud, 
    FileText, 
    X,
    FileCheck,
    Upload,
    AlertTriangle,
    ExternalLink,
    FileUp,
    Code2,
    Copy,
    Check,
    Layers,
    Tag,
    ShoppingCart
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { BaseCard } from '../base/card';
import CancelButton from '../button/CancelButton';
import TabLayout from '../tab/TabLayout';
import FilesOnClouds from '../customs/cloud/FilesOnClouds';

export interface BaseAiAssistantModalProps {
    isOpen: boolean;
    onClose: () => void;
    documentType: string;
    documentId?: number;
    currentFormData?: any;
    onApply: (data: any, bulutDosyaId?: number | null) => void;
    title?: string;
}

interface ErrorBannerState {
    message: string;
    isCloudError?: boolean;
}

const BaseAiAssistantModal: React.FC<BaseAiAssistantModalProps> = ({
    isOpen,
    onClose,
    documentType = 'KampanyaBelgesi',
    currentFormData,
    onApply,
    title
}) => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<string>('cloud');
    const [ajanlar, setAjanlar] = useState<any[]>([]);
    const [selectedAjanId, setSelectedAjanId] = useState<number | null>(null);
    const [promptText, setPromptText] = useState('');
    const [mcpJsonInput, setMcpJsonInput] = useState('');
    const [schemaInfo, setSchemaInfo] = useState<any>(null);
    const [isSchemaCopied, setIsSchemaCopied] = useState(false);
    
    const [selectedCloudFile, setSelectedCloudFile] = useState<any | null>(null);
    const [selectedLocalFile, setSelectedLocalFile] = useState<File | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    
    const [isLoading, setIsLoading] = useState(false);
    const [loadingStage, setLoadingStage] = useState<string>('');
    const [errorState, setErrorState] = useState<ErrorBannerState | null>(null);
    const [analyzedResult, setAnalyzedResult] = useState<any | null>(null);

    const fileInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (isOpen) {
            loadAjanlar();
            loadDocumentSchema();
            setErrorState(null);
            setAnalyzedResult(null);
        }
    }, [isOpen, documentType]);

    const loadAjanlar = async () => {
        try {
            const res = await axios.get('/api/AiAjanlar');
            const list = res.data || [];
            setAjanlar(list);
            
            // Belge türüne en uygun ajanı akıllıca seç
            const lowerType = (documentType || '').toLowerCase();
            const matchedAjan = list.find((a: any) => {
                const searchScope = `${a.kod || ''} ${a.ad || ''} ${a.rol || ''}`.toLowerCase();
                if (lowerType.includes('kampanya') && searchScope.includes('kampanya')) return true;
                if (lowerType.includes('fiyat') && (searchScope.includes('fiyat') || searchScope.includes('ürün'))) return true;
                if (lowerType.includes('siparis') && searchScope.includes('siparis')) return true;
                if (lowerType.includes('fatura') && (searchScope.includes('fatura') || searchScope.includes('muhasebe'))) return true;
                return false;
            });

            if (matchedAjan) {
                setSelectedAjanId(matchedAjan.id);
            } else if (list.length > 0) {
                setSelectedAjanId(list[0].id);
            }
        } catch (error) {
            console.error('Yapay zeka ajanları yüklenemedi', error);
        }
    };

    const loadDocumentSchema = async () => {
        try {
            const res = await axios.get(`/api/Mcp/document/schema/${documentType}`);
            if (res.data?.schema) {
                setSchemaInfo(res.data.schema);
            }
        } catch (err) {
            console.error('Belge MCP şeması alınamadı', err);
        }
    };

    const handleCloudFileSelect = (file: any) => {
        setSelectedCloudFile(file);
        setErrorState(null);
        toast.success(t('auto_bulut_dosyasi_secildi', 'Bulut dosyası seçildi: {{name}}', { name: file.dosyaAdi }));
    };

    const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            setSelectedLocalFile(file);
            setErrorState(null);
            toast.success(t('auto_dosya_secildi', 'Dosya seçildi: {{name}}', { name: file.name }));
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            setSelectedLocalFile(file);
            setErrorState(null);
            toast.success(t('auto_dosya_secildi', 'Dosya seçildi: {{name}}', { name: file.name }));
        }
    };

    const handleCopySchemaPrompt = () => {
        if (!schemaInfo) return;
        const promptTemplate = `Aşağıdaki Akalin UI '${documentType}' şemasına göre bir taslak JSON nesnesi üret:\n\n` +
            JSON.stringify(schemaInfo.samplePayload || schemaInfo, null, 2);

        navigator.clipboard.writeText(promptTemplate);
        setIsSchemaCopied(true);
        toast.success(t('auto_mcp_sema_kopyalandi', 'MCP Ajan istemi ve şeması panoya kopyalandı!'));
        setTimeout(() => setIsSchemaCopied(false), 2500);
    };

    const handleAnalyze = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorState(null);

        // SEKME 4: DOĞRUDAN MCP / JSON YAPIŞTIRMA
        if (activeTab === 'mcp') {
            if (!mcpJsonInput.trim()) {
                toast.error(t('auto_lutfen_json_giriniz', 'Lütfen MCP ajanından aldığınız JSON taslağını yapıştırınız.'));
                return;
            }

            try {
                setIsLoading(true);
                setLoadingStage(t('auto_mcp_json_dogrulaniyor', 'MCP taslağı doğrulanıyor ve ERP formatına dönüştürülüyor...'));

                let parsedPayload: any = null;
                try {
                    let cleaned = mcpJsonInput.trim();
                    if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
                    else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();
                    parsedPayload = JSON.parse(cleaned);
                } catch (parseErr: any) {
                    throw new Error(t('auto_gecersiz_json_formati', 'Geçersiz JSON formatı. Lütfen JSON sözdizimini kontrol ediniz.'));
                }

                // Backend MCP draft endpoint'i ile normalize et
                const draftRes = await axios.post('/api/Mcp/document/draft', {
                    documentType,
                    rawPayload: parsedPayload
                });

                if (draftRes.data?.success && draftRes.data?.eylemPayload) {
                    setAnalyzedResult(draftRes.data.eylemPayload);
                    toast.success(t('auto_mcp_taslak_hazir', 'MCP taslağı başarıyla doğrulandı ve hazırlandı!'));
                } else if (parsedPayload) {
                    setAnalyzedResult(parsedPayload);
                    toast.success(t('auto_taslak_hazir', 'Taslak başarıyla yüklendi!'));
                }
            } catch (err: any) {
                const msg = err.response?.data?.mesaj || err.message || t('auto_taslak_isleme_hatasi', 'Taslak işlenirken bir hata oluştu.');
                setErrorState({ message: msg });
                toast.error(msg);
            } finally {
                setIsLoading(false);
                setLoadingStage('');
            }
            return;
        }

        // DİĞER SEKMELER (BULUT, DOSYA, METİN)
        if (!selectedAjanId) {
            toast.error(t('auto_lutfen_ajan_secin', 'Lütfen bir yapay zeka ajanı seçiniz.'));
            return;
        }

        if (activeTab === 'cloud' && !selectedCloudFile) {
            toast.error(t('auto_lutfen_bulut_secin', 'Lütfen analiz edilecek bulut belgesini tablodan seçiniz.'));
            return;
        }

        if (activeTab === 'upload' && !selectedLocalFile) {
            toast.error(t('auto_lutfen_dosya_secin', 'Lütfen analiz edilecek PDF veya belge dosyasını seçiniz.'));
            return;
        }

        if (activeTab === 'text' && !promptText.trim()) {
            toast.error(t('auto_lutfen_metin_girin', 'Lütfen belge açıklaması, bülten metni veya AI komutu giriniz.'));
            return;
        }

        try {
            setIsLoading(true);
            setLoadingStage(t('auto_ai_belge_ayristiriyor', 'Yapay zeka dökümanı inceliyor ve kuralları ayrıştırıyor...'));
            let result: any = null;

            const isKampanya = documentType.toLowerCase().includes('kampanya');

            if (isKampanya) {
                if (activeTab === 'cloud' && selectedCloudFile) {
                    const res = await axios.post(`/api/AiAjanlar/${selectedAjanId}/kampanya-analiz`, {
                        bulutDosyaId: selectedCloudFile.id
                    });
                    result = res.data;
                } else if (activeTab === 'upload' && selectedLocalFile) {
                    const formData = new FormData();
                    formData.append('dosya', selectedLocalFile);
                    const res = await axios.post(`/api/AiAjanlar/${selectedAjanId}/kampanya-dosya-analiz`, formData, {
                        headers: { 'Content-Type': 'multipart/form-data' }
                    });
                    result = res.data;
                } else {
                    const res = await axios.post(`/api/AiAjanlar/${selectedAjanId}/kampanya-analiz`, {
                        kampanyaMetni: promptText
                    });
                    result = res.data;
                }
            } else {
                // Diğer belgeler için genel AI Belge Oluşturma veya MCP Draft çağrısı
                const res = await axios.post('/api/AiAjanlar/belge-olustur', {
                    belgeTuru: documentType,
                    prompt: promptText || selectedLocalFile?.name || selectedCloudFile?.dosyaAdi || ''
                });

                if (res.data?.basarili && res.data?.belgeVerisi) {
                    result = res.data.belgeVerisi;
                } else {
                    throw new Error(res.data?.mesaj || t('auto_ai_belge_uretemedi', 'Yapay zeka belge taslağı üretemedi.'));
                }
            }

            if (result) {
                setAnalyzedResult(result);
                toast.success(t('auto_ai_belge_analiz_basarili', 'Döküman yapay zeka tarafından başarıyla analiz edildi.'));
            }
        } catch (error: any) {
            const serverMessage = error.response?.data?.mesaj || error.message || t('auto_ai_analiz_hata', 'Belge analiz edilirken bir hata oluştu.');
            const isCloud = error.response?.data?.hataTuru === 'BULUT_YETKI_HATASI' || 
                            serverMessage.includes('Google Drive') || 
                            serverMessage.includes('OneDrive') || 
                            serverMessage.includes('Bulut');

            setErrorState({
                message: serverMessage,
                isCloudError: isCloud
            });
            toast.error(serverMessage);
        } finally {
            setIsLoading(false);
            setLoadingStage('');
        }
    };

    const handleApplyToForm = () => {
        if (!analyzedResult) return;
        onApply(analyzedResult, selectedCloudFile?.id || null);
        onClose();
    };

    if (!isOpen) return null;

    const tabs = [
        { id: 'cloud', name: t('auto_bulut_dosyalari_tab', 'Bulut Depolama & Dosyalar'), icon: <Cloud size={16} /> },
        { id: 'upload', name: t('auto_bilgisayardan_yukle_tab', 'Bilgisayardan Dosya Yükle'), icon: <Upload size={16} /> },
        { id: 'text', name: t('auto_metin_bulten_tab', 'Metin / Bülten / Prompt'), icon: <FileText size={16} /> },
        { id: 'mcp', name: t('auto_mcp_sema_tab', 'MCP & Şema Entegrasyonu'), icon: <Code2 size={16} /> }
    ];

    const selectedAjan = ajanlar.find(a => a.id === selectedAjanId);
    const isKampanya = documentType.toLowerCase().includes('kampanya');
    const modalTitle = title || t('auto_ai_mcp_asistani_baslik', '{{doc}} Yapay Zeka Asistanı & MCP', { doc: documentType });

    return (
        <div className="base-modal-backdrop" onClick={onClose}>
            <div 
                className="base-modal-container max-w-4xl w-full" 
                onClick={(e) => e.stopPropagation()}
            >
                {/* Modal Header */}
                <div className="flex items-center justify-between p-16 border-bottom-glass">
                    <div className="flex items-center gap-10">
                        <div className="p-8 rounded-8 bg-primary-alpha text-primary flex items-center justify-center">
                            <Sparkles size={20} />
                        </div>
                        <div>
                            <h3 className="m-0 text-16 font-700 text-primary">{modalTitle}</h3>
                            <span className="text-12 text-secondary">
                                {t('auto_mcp_modal_alt_bilgi', 'Model Context Protocol (MCP) ve yapay zeka ajanları ile anında taslak oluşturun.')}
                            </span>
                        </div>
                    </div>
                    <button 
                        type="button" 
                        onClick={onClose} 
                        className="btn btn-secondary p-6 rounded-full"
                        aria-label={t('auto_kapat', 'Kapat')}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="p-16 flex-col gap-16 max-h-75vh overflow-y-auto">
                    {!analyzedResult ? (
                        /* ADIM 1: GİRİŞ VE AJAN SEÇİMİ */
                        <form onSubmit={handleAnalyze} className="flex-col gap-16">
                            {/* Ajan Seçimi */}
                            <div className="ai-agent-selection-card">
                                <div className="flex items-center justify-between mb-8">
                                    <label className="form-field-label m-0 flex items-center gap-8">
                                        <Bot size={16} className="text-primary" /> {t('auto_gorevli_ai_ajan', 'Görevlendirilen Yapay Zeka Ajanı')}
                                    </label>
                                    {selectedAjan && (
                                        <span className="chip-primary text-11 font-600">
                                            {selectedAjan.rol || selectedAjan.modelAdi || 'ERP Agent'}
                                        </span>
                                    )}
                                </div>
                                <select 
                                    className="form-input w-full"
                                    value={selectedAjanId || ''}
                                    onChange={(e) => setSelectedAjanId(Number(e.target.value))}
                                >
                                    {ajanlar.map(a => (
                                        <option key={a.id} value={a.id}>
                                            {a.ad} ({a.rol}) - [{a.modelAdi || 'LLM'}]
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Hata ve Yönlendirme Banner'ı */}
                            {errorState && (
                                <div className="ai-error-banner">
                                    <div className="ai-error-banner-header">
                                        <AlertTriangle size={20} className="text-danger shrink-0 mt-2" />
                                        <div className="flex-col gap-4">
                                            <h4 className="m-0 text-13 font-700 text-danger">
                                                {errorState.isCloudError 
                                                    ? t('auto_bulut_yetki_uyarisi', 'Bulut Dosyası İndirme ve Yetkilendirme Uyarısı')
                                                    : t('auto_analiz_hatasi', 'Analiz Hatası')}
                                            </h4>
                                            <p className="m-0 text-12 opacity-90">{errorState.message}</p>
                                        </div>
                                    </div>

                                    <div className="ai-error-banner-actions">
                                        {errorState.isCloudError && (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => window.open('/sistem-ayarlari', '_blank')}
                                                    className="btn btn-secondary text-11 py-4 px-10 flex items-center gap-4"
                                                >
                                                    <ExternalLink size={13} /> {t('auto_bulut_ayarlarina_git', 'Bulut Depolama Ayarlarına Git')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setActiveTab('upload');
                                                        setErrorState(null);
                                                    }}
                                                    className="btn btn-primary text-11 py-4 px-10 flex items-center gap-4"
                                                >
                                                    <FileUp size={13} /> {t('auto_bilgisayardan_yukle_gec', 'Dosyayı Bilgisayardan Yükle Sekmesine Geç')}
                                                </button>
                                            </>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => setErrorState(null)}
                                            className="btn btn-secondary text-11 py-4 px-8 ml-auto"
                                        >
                                            <X size={13} />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Kaynak Seçim Sekmeleri */}
                            <TabLayout
                                tabs={tabs}
                                activeTabId={activeTab}
                                onChange={(tabId) => {
                                    setActiveTab(String(tabId));
                                    setErrorState(null);
                                }}
                            />

                            {/* SEKME 1: BULUT DOSYALARI */}
                            {activeTab === 'cloud' && (
                                <div className="flex-col gap-12">
                                    {selectedCloudFile && (
                                        <div className="selected-cloud-banner">
                                            <div className="selected-cloud-banner-info">
                                                <div className="selected-cloud-icon-box">
                                                    <FileCheck size={20} />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-8">
                                                        <span className="text-11 font-600 text-secondary uppercase tracking-wider">{t('auto_secilen_belge', 'Seçilen Belge')}</span>
                                                        {selectedCloudFile.provider && (
                                                            <span className="chip-primary text-10 py-2 px-6 capitalize">
                                                                {selectedCloudFile.provider}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <h4 className="m-0 text-14 font-700 text-primary">{selectedCloudFile.dosyaAdi}</h4>
                                                    <span className="text-12 text-secondary">
                                                        {selectedCloudFile.dosyaBoyutu ? `${Math.round(selectedCloudFile.dosyaBoyutu / 1024)} KB` : ''}
                                                    </span>
                                                </div>
                                            </div>
                                            <button 
                                                type="button" 
                                                onClick={() => setSelectedCloudFile(null)}
                                                className="btn btn-secondary text-12 py-6 px-12 flex items-center gap-4"
                                            >
                                                <X size={14} /> {t('auto_secimi_kaldir', 'Seçimi Kaldır')}
                                            </button>
                                        </div>
                                    )}

                                    <div className="cloud-files-embed-wrapper border rounded-12 p-8">
                                        <FilesOnClouds 
                                            isOpen={true} 
                                            isModal={false} 
                                            showFolderTree={false} 
                                            documentType={documentType}
                                            onSelectFile={handleCloudFileSelect}
                                        />
                                    </div>

                                    <span className="text-12 text-secondary">
                                        {t('auto_bulut_dosya_ipucu', 'Google Drive, OneDrive veya bulut deponuzdaki dosyayı listeden seçebilirsiniz.')}
                                    </span>
                                </div>
                            )}

                            {/* SEKME 2: BİLGİSAYARDAN DOSYA YÜKLE */}
                            {activeTab === 'upload' && (
                                <div className="flex-col gap-12">
                                    <input 
                                        type="file" 
                                        ref={fileInputRef}
                                        onChange={handleLocalFileChange}
                                        accept=".pdf,.txt,.docx,.xlsx,.csv,.json"
                                        className="hidden"
                                    />

                                    {!selectedLocalFile ? (
                                        <div 
                                            className={`ai-file-dropzone ${isDragOver ? 'active' : ''}`}
                                            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                                            onDragLeave={() => setIsDragOver(false)}
                                            onDrop={handleDrop}
                                            onClick={() => fileInputRef.current?.click()}
                                        >
                                            <div className="ai-file-dropzone-icon">
                                                <Upload size={24} />
                                            </div>
                                            <h4 className="m-0 text-14 font-700 text-primary mb-4">
                                                {t('auto_dosya_sec_surukle', 'Dosya Seçin veya Sürükleyip Bırakın')}
                                            </h4>
                                            <span className="text-12 text-secondary">
                                                {t('auto_desteklenen_formatlar', 'Desteklenen formatlar: PDF, TXT, DOCX, XLSX, CSV, JSON')}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="selected-cloud-banner">
                                            <div className="selected-cloud-banner-info">
                                                <div className="selected-cloud-icon-box">
                                                    <FileCheck size={20} />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-8">
                                                        <span className="text-11 font-600 text-secondary uppercase tracking-wider">{t('auto_yuklenen_dosya', 'Yüklenen Dosya')}</span>
                                                        <span className="chip-primary text-10 py-2 px-6">
                                                            {selectedLocalFile.name.split('.').pop()?.toUpperCase()}
                                                        </span>
                                                    </div>
                                                    <h4 className="m-0 text-14 font-700 text-primary">{selectedLocalFile.name}</h4>
                                                    <span className="text-12 text-secondary">
                                                        {`${Math.round(selectedLocalFile.size / 1024)} KB`}
                                                    </span>
                                                </div>
                                            </div>
                                            <button 
                                                type="button" 
                                                onClick={() => setSelectedLocalFile(null)}
                                                className="btn btn-secondary text-12 py-6 px-12 flex items-center gap-4"
                                            >
                                                <X size={14} /> {t('auto_secimi_kaldir', 'Seçimi Kaldır')}
                                            </button>
                                        </div>
                                    )}

                                    <span className="text-12 text-secondary">
                                        {t('auto_yuklenen_dosya_aciklama', 'Yüklediğiniz dosya yapay zeka tarafından taranarak form verileri otomatik olarak ayrıştırılacaktır.')}
                                    </span>
                                </div>
                            )}

                            {/* SEKME 3: METİN / BÜLTEN YAPISTIR */}
                            {activeTab === 'text' && (
                                <div className="flex-col gap-8">
                                    <label className="form-field-label m-0 flex items-center gap-6">
                                        <Sparkles size={15} className="text-primary" /> {t('auto_metin_veya_prompt', 'Belge Açıklaması veya Doğal Dil İstemi')} *
                                    </label>
                                    <textarea
                                        className="form-input w-full"
                                        rows={8}
                                        value={promptText}
                                        onChange={(e) => setPromptText(e.target.value)}
                                        placeholder={isKampanya 
                                            ? t('auto_kampanya_metni_ornek', 'BSH, Arçelik veya kurum içi kampanya duyuru metnini buraya yapıştırınız...') 
                                            : t('auto_genel_belge_prompt_ornek', 'Örnek: "Ahmet Ticaret için 5 adet buzdolabı ve 10 adet çamaşır makinesi içeren satış siparişi taslağı hazırla"')}
                                        autoFocus
                                    />
                                    <span className="text-12 text-secondary">
                                        {t('auto_metin_tab_ipucu', 'Yapay zeka bu metni okuyarak kalemleri, birimleri, fiyatları ve kuralları otomatik olarak oluşturacaktır.')}
                                    </span>
                                </div>
                            )}

                            {/* SEKME 4: MCP VE JSON ŞEMA ENTEGRASYONU */}
                            {activeTab === 'mcp' && (
                                <div className="flex-col gap-12">
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <h4 className="m-0 text-13 font-700 text-primary flex items-center gap-6">
                                                <Code2 size={16} /> {t('auto_mcp_sema_ve_ajan_istemi', 'MCP Şeması & Harici Ajanlar (Cursor / Claude / Antigravity)')}
                                            </h4>
                                            <span className="text-12 text-secondary">
                                                {t('auto_mcp_sema_aciklama', 'Harici ajanınıza aşağıdaki şemayı vererek oluşturduğu JSON taslağını alttaki alana doğrudan yapıştırabilirsiniz.')}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleCopySchemaPrompt}
                                            className="btn btn-secondary text-12 py-6 px-12 flex items-center gap-6 shrink-0"
                                        >
                                            {isSchemaCopied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                                            {isSchemaCopied ? t('auto_kopyalandi', 'Kopyalandı') : t('auto_semayi_kopyala', 'Şemayı Kopyala')}
                                        </button>
                                    </div>

                                    {schemaInfo && (
                                        <pre className="ai-mcp-schema-box">
                                            {JSON.stringify(schemaInfo, null, 2)}
                                        </pre>
                                    )}

                                    <div className="flex-col gap-6 mt-4">
                                        <label className="form-field-label m-0">
                                            {t('auto_mcp_json_yapistir', 'MCP veya AI Ajanından Üretilen JSON Taslağını Yapıştırın:')}
                                        </label>
                                        <textarea
                                            className="form-input w-full font-mono text-12"
                                            rows={6}
                                            value={mcpJsonInput}
                                            onChange={(e) => setMcpJsonInput(e.target.value)}
                                            placeholder='{ "adi": "Örnek Kampanya", "kampanyalar": [ ... ] }'
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Alt Eylem Butonları */}
                            <div className="flex justify-between items-center pt-12 border-top-glass">
                                {isLoading ? (
                                    <div className="flex items-center gap-8 text-12 text-primary font-600">
                                        <RefreshCw size={16} className="animate-spin" />
                                        <span>{loadingStage || t('auto_ai_analiz_ediyor', 'Yapay Zeka Analiz Ediyor...')}</span>
                                    </div>
                                ) : (
                                    <div />
                                )}

                                <div className="flex gap-12">
                                    <CancelButton onClick={onClose} />
                                    <button 
                                        type="submit" 
                                        className="btn btn-primary flex items-center gap-8"
                                        disabled={
                                            isLoading || 
                                            (activeTab === 'cloud' && !selectedCloudFile) || 
                                            (activeTab === 'upload' && !selectedLocalFile) || 
                                            (activeTab === 'text' && !promptText.trim()) ||
                                            (activeTab === 'mcp' && !mcpJsonInput.trim())
                                        }
                                    >
                                        {isLoading ? (
                                            <>
                                                <RefreshCw size={16} className="animate-spin" /> {t('auto_ai_analiz_ediyor', 'Yapay Zeka Analiz Ediyor...')}
                                            </>
                                        ) : (
                                            <>
                                                <Sparkles size={16} /> {activeTab === 'mcp' ? t('auto_mcp_taslak_cozumle', 'MCP Taslağını Çözümle ve Önizle') : t('auto_analiz_et_olustur', 'Analiz Et ve Taslak Hazırla')}
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </form>
                    ) : (
                        /* ADIM 2: ANALİZ SONUÇLARI ÖNİZLEME */
                        <div className="flex-col gap-16">
                            <div className="ai-analysis-success-banner">
                                <CheckCircle2 size={20} className="text-success shrink-0" />
                                <div>
                                    <h4 className="m-0 text-14 font-700">{t('auto_taslak_basariyla_cozumilendi', 'Belge Taslağı Başarıyla Çözümlendi!')}</h4>
                                    <p className="m-0 text-12 opacity-80 mt-2">
                                        {t('auto_taslak_onay_mesaj', 'Aşağıdaki verileri kontrol edip "Forma Aktar ve Uygula" düğmesine basarak doğrudan formunuza aktarabilirsiniz.')}
                                    </p>
                                </div>
                            </div>

                            {/* Belge Başlığı & Tarihler Özeti */}
                            <BaseCard variant="elevated">
                                <div className="p-16 flex-col gap-12">
                                    <div className="flex justify-between items-start flex-wrap gap-8">
                                        <div>
                                            <span className="text-11 font-600 text-secondary uppercase tracking-wider">{t('auto_belge_basligi', 'Belge Başlığı')}</span>
                                            <h3 className="m-0 text-16 font-700 text-primary">
                                                {analyzedResult.adi || analyzedResult.header?.adi || analyzedResult.header?.aciklama || analyzedResult.aciklama || `${documentType} Taslağı`}
                                            </h3>
                                        </div>
                                        {(analyzedResult.baslangicTarihi || analyzedResult.header?.tarih) && (
                                            <div className="flex items-center gap-6 text-12 font-600 bg-primary-alpha py-4 px-10 rounded-8">
                                                <Calendar size={14} />
                                                <span>
                                                    {String(analyzedResult.baslangicTarihi || analyzedResult.header?.tarih).substring(0, 10)}
                                                    {analyzedResult.bitisTarihi ? ` - ${String(analyzedResult.bitisTarihi).substring(0, 10)}` : ''}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </BaseCard>

                            {/* Kampanya Detayları Listesi */}
                            {isKampanya && Array.isArray(analyzedResult.kampanyalar) && analyzedResult.kampanyalar.length > 0 && (
                                <div className="flex-col gap-10 max-h-300 overflow-y-auto pr-4">
                                    {analyzedResult.kampanyalar.map((k: any, i: number) => (
                                        <div key={i} className="ai-campaign-preview-item">
                                            <div className="flex justify-between items-start mb-6">
                                                <div className="flex items-center gap-8">
                                                    <div className="ai-campaign-index-badge">{i + 1}</div>
                                                    <h4 className="m-0 text-14 font-700 text-primary">{k.adi}</h4>
                                                </div>
                                                <div className="flex items-center gap-6">
                                                    {k.birlesmeKurali && (
                                                        <span className="chip-primary text-10 font-600">
                                                            {t('auto_birlesme', 'Birleşme')}: #{k.birlesmeKurali}
                                                        </span>
                                                    )}
                                                    {k.toplamAdetSiniri && (
                                                        <span className="chip-primary text-10 font-600">
                                                            {t('auto_kota', 'Kota')}: {k.toplamAdetSiniri} {t('auto_adet', 'Adet')}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-12 text-12 bg-secondary p-10 rounded-8">
                                                <div>
                                                    <span className="text-secondary block text-11">{t('auto_tuketici_indirimi', 'Tüketici İndirimi')}:</span>
                                                    <span className="font-700 text-primary">
                                                        {k.aksiyonDegeri ? `${k.aksiyonDegeri.toLocaleString()} (${k.aksiyonTipi === 1 ? '%' : '₺'})` : t('auto_fiyat_farki_belgesi', 'Fiyat Farkı')}
                                                    </span>
                                                </div>
                                                <div>
                                                    <span className="text-secondary block text-11">{t('auto_bayi_hakedisi', 'Bayi Hakedişi')}:</span>
                                                    <span className="font-700 text-success">
                                                        {k.firmaHakEdisTutari ? `${k.firmaHakEdisTutari.toLocaleString()} ₺` : (k.firmaHakEdisOrani ? `%${k.firmaHakEdisOrani}` : '-')}
                                                    </span>
                                                </div>
                                            </div>

                                            {k.kurallar && k.kurallar.length > 0 && (
                                                <div className="mt-8 text-11 text-secondary">
                                                    <span className="font-600">{t('auto_kurallar', 'Kurallar')}: </span>
                                                    {k.kurallar.map((r: any, ri: number) => (
                                                        <span key={ri} className="mr-6">
                                                            [{r.gerekliMiktar || 1} {t('auto_adet', 'Adet')} - {r.kuralDegeri}]
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Kalemler Tablosu (Siparis / Fatura / Fiyat Listesi) */}
                            {Array.isArray(analyzedResult.kalemler) && analyzedResult.kalemler.length > 0 && (
                                <div className="flex-col gap-6">
                                    <span className="text-12 font-600 text-secondary">
                                        {t('auto_taslak_kalemleri', 'Taslak Kalemleri (Toplam {{count}} Kalem):', { count: analyzedResult.kalemler.length })}
                                    </span>
                                    <div className="border rounded-8 max-h-220 overflow-y-auto">
                                        <table className="w-full text-12 text-left">
                                            <thead>
                                                <tr className="bg-secondary text-secondary border-b">
                                                    <th className="p-8">#</th>
                                                    <th className="p-8">{t('auto_urun_hizmet', 'Ürün / Hizmet')}</th>
                                                    <th className="p-8">{t('auto_miktar', 'Miktar')}</th>
                                                    <th className="p-8">{t('auto_birim_fiyat', 'Birim Fiyat')}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {analyzedResult.kalemler.map((item: any, idx: number) => (
                                                    <tr key={idx} className="border-b">
                                                        <td className="p-8 text-secondary">{idx + 1}</td>
                                                        <td className="p-8 font-500">{item.urunVeHizmetAdi || item.tedarikciUrunKodu || item.ad || '-'}</td>
                                                        <td className="p-8">{item.miktar || 1}</td>
                                                        <td className="p-8 font-600">{item.birimFiyat ? `${Number(item.birimFiyat).toLocaleString()} ₺` : (item.fiyat ? `${Number(item.fiyat).toLocaleString()} ₺` : '-')}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Alt Aksiyonlar */}
                            <div className="flex justify-between items-center pt-16 border-top-glass">
                                <button 
                                    type="button" 
                                    onClick={() => setAnalyzedResult(null)}
                                    className="btn btn-secondary flex items-center gap-6"
                                >
                                    <RefreshCw size={14} /> {t('auto_yeniden_analiz_et', 'Yeniden Analiz Et')}
                                </button>
                                
                                <div className="flex gap-12">
                                    <CancelButton onClick={onClose} />
                                    <button 
                                        type="button" 
                                        onClick={handleApplyToForm}
                                        className="btn btn-primary flex items-center gap-8"
                                    >
                                        <CheckCircle2 size={16} /> {t('auto_forma_aktar_ve_uygula', 'Forma Aktar ve Uygula')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BaseAiAssistantModal;
