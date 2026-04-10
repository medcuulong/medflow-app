/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { 
  FileDown, CheckCircle2, Stethoscope, Trash2, 
  Loader2, AlertCircle, FileText, Plus, Folder, 
  Edit, Save, X, Database, Search, Pencil, Check,
  ChevronDown, ChevronRight, FolderOpen, Printer,
  Settings, CloudUpload, FilePlus, MapPin,
  ArrowUp, ArrowDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { saveAs } from 'file-saver';
import * as mammoth from 'mammoth';

// FIREBASE
import { db } from './firebase';
import { doc, getDoc, getDocs, collection, writeBatch } from 'firebase/firestore';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- HÀM SIÊU CHUẨN HÓA TIẾNG VIỆT ---
const normalizeVN = (str: string) => {
  if (!str) return '';
  return str
    .normalize('NFD') 
    .replace(/[\u0300-\u036f]/g, '') 
    .replace(/đ/g, 'd').replace(/Đ/g, 'D') 
    .replace(/\s+/g, ' ') 
    .toLowerCase() 
    .trim();
};

const stripPrefixNumber = (str: string) => {
  if (!str) return '';
  return str.replace(/^\d+[\.\-\s]*/, '').trim();
};

// --- KIỂU DỮ LIỆU ---
interface Technique { id: string; name: string; contentHtml: string; isExtracted: boolean; }
interface SubGroup { id: string; name: string; order?: number; techniques: Technique[]; }
interface Group { id: string; name: string; decisionNum?: string; issueDate?: string; order?: number; subGroups: SubGroup[]; }
interface SearchResult extends Technique { group: Group; subGroup: SubGroup; }

export default function App() {
  // ÁO GIÁP 1: BẢO VỆ LÚC KHỞI TẠO TỪ LOCAL STORAGE
  const [groups, setGroups] = useState<Group[]>(() => {
    const savedData = localStorage.getItem('medflow_local_backup');
    if (savedData) {
      try { 
        const parsed = JSON.parse(savedData); 
        // Bắt buộc phải là 1 mảng dữ liệu (Array), nếu là rác {} thì bỏ qua
        if (Array.isArray(parsed)) return parsed; 
      } catch (e) {}
    }
    return [
      { id: 'g1', name: 'Chẩn đoán hình ảnh', decisionNum: '', issueDate: '', order: 0, subGroups: [] }
    ];
  });
  
  const [expandedGroups, setExpandedGroups] = useState<string[]>(groups?.length > 0 ? [groups[0].id] : []);
  const [activeIds, setActiveIds] = useState<{groupId: string | null, subGroupId: string | null}>({
    groupId: groups?.length > 0 ? groups[0].id : null, 
    subGroupId: groups?.length > 0 && groups[0].subGroups?.length > 0 ? groups[0].subGroups[0].id : null
  });
  
  const [newGroupName, setNewGroupName] = useState('');
  const [addingSubGroupTo, setAddingSubGroupTo] = useState<string | null>(null);
  const [newSubGroupName, setNewSubGroupName] = useState('');

  const [bytHtml, setBytHtml] = useState<string>(''); 
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [editingTech, setEditingTech] = useState<Technique | null>(null);
  const [editContent, setEditContent] = useState('');

  const [editingGroupMeta, setEditingGroupMeta] = useState<Group | null>(null);
  
  const [searchInput, setSearchInput] = useState(''); 
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(''); 

  useEffect(() => {
    const timerId = setTimeout(() => { setDebouncedSearchTerm(searchInput); }, 300); 
    return () => clearTimeout(timerId);
  }, [searchInput]);

  const [renamingTechId, setRenamingTechId] = useState<string | null>(null);
  const [newTechName, setNewTechName] = useState('');

  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [renamingSubGroupId, setRenamingSubGroupId] = useState<string | null>(null);
  const [editSubGroupName, setEditSubGroupName] = useState('');

  const [includeExportMeta, setIncludeExportMeta] = useState(true);

  // ÁO GIÁP 2: TÌM KIẾM AN TOÀN CHỐNG SẬP TỪ HOOK TÌM THƯ MỤC ACTIVE
  const activeGroup = groups?.find(g => g.id === activeIds.groupId);
  const activeSubGroup = activeGroup?.subGroups?.find(sg => sg.id === activeIds.subGroupId);

  useEffect(() => {
    try {
      localStorage.setItem('medflow_local_backup', JSON.stringify(groups || []));
    } catch (error) {
      console.warn("Bộ nhớ trình duyệt đầy, vui lòng lưu lên Cloud thường xuyên.");
    }
  }, [groups]);

  // --- TẢI DATA TỪ FIREBASE KÈM ÁO GIÁP CHỐNG LỖI ---
  useEffect(() => {
    const fetchCloudData = async () => {
      try {
        const [gSnap, sgSnap, tSnap] = await Promise.all([
          getDocs(collection(db, "medflow_groups")),
          getDocs(collection(db, "medflow_subgroups")),
          getDocs(collection(db, "medflow_techniques"))
        ]);

        const fetchedGroups: Group[] = [];

        if (!gSnap.empty || !sgSnap.empty || !tSnap.empty) {
          gSnap.forEach((doc) => {
            const data = doc.data();
            fetchedGroups.push({ id: data.id, name: data.name, decisionNum: data.decisionNum, issueDate: data.issueDate, order: data.order || 0, subGroups: [] });
          });

          sgSnap.forEach((doc) => {
            const data = doc.data();
            const parent = fetchedGroups.find(g => g.id === data.parentGroupId);
            if (parent) {
              if (!parent.subGroups) parent.subGroups = [];
              parent.subGroups.push({ id: data.id, name: data.name, order: data.order || 0, techniques: [] });
            }
          });

          tSnap.forEach((doc) => {
            const data = doc.data();
            const parentGroup = fetchedGroups.find(g => g.id === data.groupId);
            if (parentGroup) {
              const parentSg = parentGroup.subGroups?.find(sg => sg.id === data.subGroupId);
              if (parentSg) {
                if (!parentSg.techniques) parentSg.techniques = [];
                parentSg.techniques.push({
                  id: data.id, name: data.name, contentHtml: data.contentHtml, isExtracted: data.isExtracted
                });
              }
            }
          });
        } 
        else {
          // LẤY DỮ LIỆU TỪ KHO CŨ NẾU KHO MỚI TRỐNG
          const masterDocRef = doc(db, "medflow", "master_data");
          const masterSnap = await getDoc(masterDocRef);
          if (masterSnap.exists()) {
            const oldData = masterSnap.data().groups;
            if (oldData && Array.isArray(oldData)) {
              fetchedGroups.push(...oldData);
            }
          }
        }

        // BẢO VỆ CHỐNG SẬP KHI SẮP XẾP DỮ LIỆU BỊ THIẾU
        fetchedGroups.sort((a, b) => (a.order || 0) - (b.order || 0));
        fetchedGroups.forEach(g => {
          if (!g.subGroups) g.subGroups = [];
          g.subGroups.sort((a, b) => (a.order || 0) - (b.order || 0));
          g.subGroups.forEach(sg => {
            if (!sg.techniques) sg.techniques = [];
            sg.techniques.sort((a, b) => (a?.id || "").localeCompare(b?.id || ""));
          });
        });

        if (fetchedGroups.length > 0) {
          setGroups(fetchedGroups);
          if (!activeIds.groupId) {
            setExpandedGroups([fetchedGroups[0].id]);
            setActiveIds({ groupId: fetchedGroups[0].id, subGroupId: fetchedGroups[0].subGroups[0]?.id || null });
          }
        }
      } catch (error) {
        console.warn("Lỗi tải Firebase, đang dùng Local Backup.");
      }
    };
    fetchCloudData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncToCloud = async () => {
    try {
      setIsProcessing(true);
      const groupsCol = collection(db, "medflow_groups");
      const subGroupsCol = collection(db, "medflow_subgroups");
      const techniquesCol = collection(db, "medflow_techniques");

      const [existG, existSG, existT] = await Promise.all([ getDocs(groupsCol), getDocs(subGroupsCol), getDocs(techniquesCol) ]);

      const currentGIds = groups?.map(g => g.id) || [];
      const currentSGIds = groups?.flatMap(g => g.subGroups?.map(sg => sg.id) || []) || [];
      const currentTIds = groups?.flatMap(g => g.subGroups?.flatMap(sg => sg.techniques?.map(t => t.id) || []) || []) || [];

      const batches: Promise<void>[] = [];
      let currentBatch = writeBatch(db);
      let opCount = 0;

      const pushOpToBatch = () => {
        opCount++;
        if (opCount >= 400) { batches.push(currentBatch.commit()); currentBatch = writeBatch(db); opCount = 0; }
      };

      existG.forEach(d => { if (!currentGIds.includes(d.id)) { currentBatch.delete(d.ref); pushOpToBatch(); }});
      existSG.forEach(d => { if (!currentSGIds.includes(d.id)) { currentBatch.delete(d.ref); pushOpToBatch(); }});
      existT.forEach(d => { if (!currentTIds.includes(d.id)) { currentBatch.delete(d.ref); pushOpToBatch(); }});

      groups?.forEach((group, gIndex) => {
        currentBatch.set(doc(groupsCol, group.id), { id: group.id, name: group.name, decisionNum: group.decisionNum || '', issueDate: group.issueDate || '', order: gIndex });
        pushOpToBatch();
        group.subGroups?.forEach((sg, sgIndex) => {
          currentBatch.set(doc(subGroupsCol, sg.id), { id: sg.id, name: sg.name, parentGroupId: group.id, order: sgIndex });
          pushOpToBatch();
          sg.techniques?.forEach(t => {
            currentBatch.set(doc(techniquesCol, t.id), { id: t.id, name: t.name, contentHtml: t.contentHtml, isExtracted: t.isExtracted, subGroupId: sg.id, groupId: group.id });
            pushOpToBatch();
          });
        });
      });

      if (opCount > 0) batches.push(currentBatch.commit());
      await Promise.all(batches);
      alert("Đã lưu an toàn lên Cloud!\n(Dữ liệu đã được phân mảnh tự động)");
    } catch (error: any) { alert(`Lỗi đồng bộ Firebase!\nChi tiết: ${error.message}`); } finally { setIsProcessing(false); }
  };

  const moveGroupUp = (index: number) => {
    if (index === 0) return;
    setGroups(prev => { const newGroups = [...prev]; [newGroups[index - 1], newGroups[index]] = [newGroups[index], newGroups[index - 1]]; return newGroups; });
  };
  const moveGroupDown = (index: number) => {
    if (index === groups.length - 1) return;
    setGroups(prev => { const newGroups = [...prev]; [newGroups[index + 1], newGroups[index]] = [newGroups[index], newGroups[index + 1]]; return newGroups; });
  };

  const updateActiveSubGroup = (updater: (sg: SubGroup) => SubGroup) => { setGroups(prev => prev.map(g => { if (g.id === activeIds.groupId) { return { ...g, subGroups: g.subGroups?.map(sg => sg.id === activeIds.subGroupId ? updater(sg) : sg) || [] }; } return g; })); };
  const updateTechniqueGlobally = (techId: string, updater: (t: Technique) => Technique) => { setGroups(prev => prev.map(g => ({ ...g, subGroups: g.subGroups?.map(sg => ({ ...sg, techniques: sg.techniques?.map(t => t.id === techId ? updater(t) : t) || [] })) || [] }))); };
  const deleteTechniqueGlobally = (techId: string) => { if (confirm("Xóa kỹ thuật này khỏi hệ thống?")) { setGroups(prev => prev.map(g => ({ ...g, subGroups: g.subGroups?.map(sg => ({ ...sg, techniques: sg.techniques?.filter(t => t.id !== techId) || [] })) || [] }))); } };

  const globalSearchResults = useMemo(() => {
    if (!debouncedSearchTerm.trim()) return [];
    const normalizedSearch = normalizeVN(debouncedSearchTerm);
    const results: SearchResult[] = [];
    groups?.forEach(g => { g.subGroups?.forEach(sg => { sg.techniques?.forEach(t => { if (normalizeVN(t.name).includes(normalizedSearch)) { results.push({ ...t, group: g, subGroup: sg }); } }); }); });
    return results;
  }, [groups, debouncedSearchTerm]);

  const currentFolderTechniques = activeSubGroup?.techniques || [];

  // --- BỔ SUNG TỪ KHÓA MỤC LỤC CHO CẢ CĐHA VÀ XÉT NGHIỆM ---
  const extractTechniqueLogic = (children: Element[], normalizedTexts: string[], techName: string) => {
    const BYT_SECTIONS_NORM = [
      // Chẩn đoán hình ảnh
      "dai cuong", "chi dinh", "chong chi dinh", "than trong", "chuan bi", "tien hanh", "theo doi", "tai bien",
      // Xét nghiệm & Phục hồi chức năng bổ sung
      "an toan", "cac buoc tien hanh", "nhung sai sot", "xu tri", "tieu chuan", "danh gia", "kiem tra chat luong"
    ];
    
    const cleanTargetName = stripPrefixNumber(techName);
    const normalizedTargetName = normalizeVN(cleanTargetName);
    let startIndex = -1;

    for (let i = 0; i < children.length; i++) {
      const rawText = children[i].textContent || '';
      const textNorm = normalizedTexts[i] || ''; 
      if (/^\d+\.\s/.test(rawText.trim()) && textNorm.includes(normalizedTargetName)) { startIndex = i; break; }
    }
    
    if (startIndex !== -1) {
      let endIndex = children.length;
      const titleElement = children[startIndex] as HTMLElement;
      titleElement.style.textAlign = 'center'; titleElement.style.fontWeight = 'bold'; titleElement.style.fontSize = '16pt';

      for (let i = startIndex + 1; i < children.length; i++) {
        const rawText = children[i].textContent || '';
        const textNorm = normalizedTexts[i] || ''; 
        if (textNorm.startsWith("tai lieu tham khao")) { endIndex = i; break; }
        if (/^\d+\.\s/.test(rawText.trim())) {
          const textAfterNumber = rawText.replace(/^\d+\.\s/, '').trim();
          // Kiểm tra xem dòng đó có viết IN HOA không
          const isAllUpper = (textAfterNumber === textAfterNumber.toUpperCase() && textAfterNumber.length > 5);
          const textAfterNumNorm = normalizeVN(textAfterNumber);
          
          // Dò xem nó có nằm trong danh sách mục lục (CĐHA + Xét nghiệm) không
          const isBytSection = BYT_SECTIONS_NORM.some(section => textAfterNumNorm.includes(section));
          
          // Nếu IN HOA mà KHÔNG PHẢI mục lục cho phép -> Đó là Kỹ thuật mới -> Chặt khúc tại đây!
          if (isAllUpper && !isBytSection) { endIndex = i; break; }
        }
      }
      return { content: children.slice(startIndex, endIndex).map(el => el.outerHTML).join(''), success: true };
    }
    return { content: '', success: false };
  };

  const openEditor = (tech: Technique) => {
    setEditingTech(tech);
    if (tech.isExtracted && tech.contentHtml) setEditContent(tech.contentHtml);
    else setEditContent(`<h1 style='text-align: center; font-size: 16pt; font-weight: bold; text-transform: uppercase;'>${stripPrefixNumber(tech.name)}</h1><p><strong>1. ĐẠI CƯƠNG</strong></p><p><br></p><p><strong>2. CHỈ ĐỊNH</strong></p><p><br></p><p><strong>3. CHỐNG CHỈ ĐỊNH</strong></p><p><br></p><p><strong>4. THẬN TRỌNG</strong></p><p><br></p><p><strong>5. CHUẨN BỊ</strong></p><p><br></p><p><strong>6. CÁC BƯỚC TIẾN HÀNH</strong></p><p><br></p><p><strong>7. THEO DÕI VÀ XỬ TRÍ TAI BIẾN</strong></p><p><br></p>`);
  };

  const handleSaveEdit = () => { if (!editingTech) return; updateTechniqueGlobally(editingTech.id, t => ({ ...t, contentHtml: editContent, isExtracted: true })); setEditingTech(null); };
  const toggleGroup = (id: string) => setExpandedGroups(prev => prev.includes(id) ? prev.filter(gId => gId !== id) : [...prev, id]);
  const handleAddGroup = (e: React.FormEvent) => { e.preventDefault(); if (!newGroupName.trim()) return; const newGroup: Group = { id: `g-${Date.now()}`, name: newGroupName.trim(), decisionNum: '', issueDate: '', order: groups?.length || 0, subGroups: [] }; setGroups([...(groups||[]), newGroup]); setExpandedGroups([...expandedGroups, newGroup.id]); setNewGroupName(''); };
  const saveGroupMeta = () => { if (!editingGroupMeta) return; setGroups(prev => prev.map(g => g.id === editingGroupMeta.id ? { ...g, name: editingGroupMeta.name, decisionNum: editingGroupMeta.decisionNum, issueDate: editingGroupMeta.issueDate } : g)); setEditingGroupMeta(null); };
  const handleDeleteGroup = (id: string) => { if (confirm("Xóa Nhóm lớn này?")) { setGroups((groups||[]).filter(g => g.id !== id)); if (activeIds.groupId === id) setActiveIds({groupId: null, subGroupId: null}); } };
  const saveNewSubGroup = (groupId: string) => { if (newSubGroupName.trim()) { const newSg: SubGroup = { id: `sg-${Date.now()}`, name: newSubGroupName.trim(), order: groups.find(g=>g.id===groupId)?.subGroups?.length || 0, techniques: [] }; setGroups(prev => prev.map(g => g.id === groupId ? { ...g, subGroups: [...(g.subGroups||[]), newSg] } : g)); setActiveIds({groupId, subGroupId: newSg.id}); setSearchInput(''); } setAddingSubGroupTo(null); setNewSubGroupName(''); };
  const handleDeleteSubGroup = (groupId: string, subGroupId: string) => { if (confirm("Xóa nhóm nhỏ này?")) { setGroups(prev => prev.map(g => g.id === groupId ? { ...g, subGroups: g.subGroups?.filter(sg => sg.id !== subGroupId) || [] } : g)); if (activeIds.subGroupId === subGroupId) setActiveIds({groupId, subGroupId: null}); } };
  const handleDeleteAllTechsInFolder = () => { if (!activeSubGroup || activeSubGroup.techniques.length === 0) return; if (window.confirm(`CẢNH BÁO NGUY HIỂM!\n\nAnh có chắc chắn muốn xóa TOÀN BỘ kỹ thuật trong thư mục "${activeSubGroup.name}" không?`)) { updateActiveSubGroup(sg => ({ ...sg, techniques: [] })); } };
  const startRenamingGroup = (group: Group) => { setRenamingGroupId(group.id); setEditGroupName(group.name); };
  const saveRenamedGroup = () => { if (!editGroupName.trim() || !renamingGroupId) { setRenamingGroupId(null); return; } setGroups(prev => prev.map(g => g.id === renamingGroupId ? { ...g, name: editGroupName.trim() } : g)); setRenamingGroupId(null); };
  const startRenamingSubGroup = (sg: SubGroup) => { setRenamingSubGroupId(sg.id); setEditSubGroupName(sg.name); };
  const saveRenamedSubGroup = (groupId: string) => { if (!editSubGroupName.trim() || !renamingSubGroupId) { setRenamingSubGroupId(null); return; } setGroups(prev => prev.map(g => g.id === groupId ? { ...g, subGroups: g.subGroups?.map(sg => sg.id === renamingSubGroupId ? { ...sg, name: editSubGroupName.trim() } : sg) || [] } : g)); setRenamingSubGroupId(null); };
  const startRenaming = (tech: Technique) => { setRenamingTechId(tech.id); setNewTechName(tech.name); };
  const saveRenamedTech = () => {
    if (!newTechName.trim() || !renamingTechId) { setRenamingTechId(null); return; }
    const cleanName = newTechName.trim();
    let updatedContent = '', isSuccess = false;
    if (bytHtml) {
      const doc = new DOMParser().parseFromString(bytHtml, 'text/html');
      const children = Array.from(doc.body.children);
      const normalizedTexts = children.map(child => normalizeVN(child.textContent || ''));
      const result = extractTechniqueLogic(children, normalizedTexts, cleanName);
      updatedContent = result.content;
      isSuccess = result.success;
    }
    updateTechniqueGlobally(renamingTechId, t => ({ ...t, name: cleanName, contentHtml: isSuccess ? updatedContent : t.contentHtml, isExtracted: isSuccess ? true : t.isExtracted }));
    setRenamingTechId(null);
  };

  const onDropClinic = useCallback((acceptedFiles: File[]) => {
    if (!activeSubGroup) return alert("Chọn thư mục nhóm nhỏ trước khi nạp Excel!");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = XLSX.utils.sheet_to_json(XLSX.read(e.target?.result, { type: 'binary' }).Sheets[XLSX.read(e.target?.result, { type: 'binary' }).SheetNames[0]]) as any[];
        const rawNamesFromExcel = json.map(item => String(item['Tên kỹ thuật'] || item['name'] || Object.values(item)[0] || '').trim()).filter(Boolean);
        const existingNamesNorm = activeSubGroup.techniques?.map(t => normalizeVN(t.name)) || [];
        const duplicates: string[] = [];
        const newTechs: Technique[] = [];

        rawNamesFromExcel.forEach((rawName, idx) => {
          const normName = normalizeVN(rawName);
          if (existingNamesNorm.includes(normName) || newTechs.some(t => normalizeVN(t.name) === normName)) { duplicates.push(rawName); } 
          else { newTechs.push({ id: `tech-${Date.now()}-${idx}`, name: rawName, contentHtml: '', isExtracted: false }); }
        });

        if (duplicates.length > 0) alert(`CẢNH BÁO:\nĐã bỏ qua ${duplicates.length} kỹ thuật bị trùng lặp`);
        if (newTechs.length === 0) return alert("Không tìm thấy tên kỹ thuật hợp lệ nào!");
        updateActiveSubGroup(sg => ({ ...sg, techniques: [...(sg.techniques||[]), ...newTechs] }));
      } catch (err) { alert("File Excel không đúng chuẩn."); }
    };
    reader.readAsBinaryString(acceptedFiles[0]);
  }, [activeSubGroup]);

  // CẮT HÌNH ẢNH + TÍNH TOÁN TRƯỚC GIẢM TẢI CHO CPU
  const onDropWord = useCallback(async (acceptedFiles: File[]) => {
    if (!activeSubGroup || activeSubGroup.techniques?.length === 0) return alert("Hãy nạp danh sách Excel trước!");
    setIsProcessing(true);
    
    setTimeout(async () => {
      try {
        const buffer = await acceptedFiles[0].arrayBuffer();
        const options = { convertImage: mammoth.images.imgElement(function(image) { return Promise.resolve({src: ""}); }) };
        const rawResult = await mammoth.convertToHtml({ arrayBuffer: buffer }, options);
        const cleanHtmlNoImages = rawResult.value.replace(/<img[^>]*>/gi, ""); 
        
        setBytHtml(cleanHtmlNoImages);
        const children = Array.from(new DOMParser().parseFromString(cleanHtmlNoImages, 'text/html').body.children);
        const normalizedTexts = children.map(child => normalizeVN(child.textContent || ''));

        updateActiveSubGroup(sg => ({
          ...sg, techniques: sg.techniques?.map(tech => {
            if (tech.isExtracted) return tech;
            const res = extractTechniqueLogic(children, normalizedTexts, tech.name);
            return res.success ? { ...tech, contentHtml: res.content, isExtracted: true } : tech;
          }) || []
        }));
      } catch (e) { alert("Lỗi xử lý Word!"); } finally { setIsProcessing(false); }
    }, 50); 
  }, [activeSubGroup]);

  const excelDrop = useDropzone({ onDrop: onDropClinic, multiple: false, accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'application/vnd.ms-excel': ['.xls'], 'text/csv': ['.csv'] } });
  const wordDrop = useDropzone({ onDrop: onDropWord, multiple: false, accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } });

  const getDocumentHeaderHtml = (title: string, groupMeta?: Group) => {
    const showMeta = includeExportMeta && (groupMeta?.decisionNum || groupMeta?.issueDate);
    const metaBlock = showMeta ? `<p style='text-align: center; font-style: italic; font-size: 13pt; margin-bottom: 30pt;'>(Ban hành kèm theo Quyết định số ${groupMeta.decisionNum || '...'} ngày ${groupMeta.issueDate || '...'})</p>` : `<div style="margin-bottom: 30pt;"></div>`;
    return `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><style> body { font-family: 'Times New Roman', serif; font-size: 14pt; line-height: 1.5; color: #000; } p { margin: 0 0 10pt 0; text-align: justify; } strong, b { font-weight: bold; } ul, ol { margin-top: 0; margin-bottom: 10pt; } li { margin-bottom: 5pt; text-align: justify; } </style></head><body>
        <h1 style='text-align: center; font-size: 16pt; font-weight: bold; margin-bottom: 5pt; text-transform: uppercase;'>DANH MỤC QUY TRÌNH KỸ THUẬT: ${title}</h1>
        ${metaBlock}
    `;
  };

  const exportGroupToWord = () => {
    if (!activeSubGroup || !activeGroup) return;
    const extractedTechs = activeSubGroup.techniques?.filter(t => t.isExtracted) || [];
    if (extractedTechs.length === 0) return alert("Trống!");
    saveAs(new Blob(['\ufeff', getDocumentHeaderHtml(activeGroup.name, activeGroup) + extractedTechs.map(t => t.contentHtml).join("<br clear=all style='mso-special-character:line-break;page-break-before:always'>") + "</body></html>"], { type: 'application/msword' }), `Quy_Trinh_${activeSubGroup.name.replace(/\s+/g, '_')}.doc`);
  };

  const exportSingleToWord = (tech: Technique, group: Group) => { saveAs(new Blob(['\ufeff', getDocumentHeaderHtml(group.name, group) + tech.contentHtml + "</body></html>"], { type: 'application/msword' }), `${stripPrefixNumber(tech.name).replace(/\s+/g, '_')}.doc`); };
  const exportSingleToPdf = (tech: Technique, group: Group) => {
    const printWindow = window.open('', '_blank', 'height=800,width=800');
    if (!printWindow) return alert("Cho phép Pop-up để in!");
    const showMeta = includeExportMeta && (group.decisionNum || group.issueDate);
    const metaBlock = showMeta ? `<p style='text-align: center; font-style: italic; font-size: 13pt; margin-bottom: 30pt;'>(Ban hành kèm theo Quyết định số ${group.decisionNum || '...'} ngày ${group.issueDate || '...'})</p>` : `<div style="margin-bottom: 30pt;"></div>`;
    printWindow.document.write(`
      <html><head><title>${stripPrefixNumber(tech.name)}</title><style> body { font-family: 'Times New Roman', serif; font-size: 14pt; line-height: 1.5; padding: 20px; color: #000; } p { margin: 0 0 10pt 0; text-align: justify; } strong, b { font-weight: bold; } @page { margin: 2cm; } </style></head><body>
          <h1 style='text-align: center; font-size: 16pt; font-weight: bold; margin-bottom: 5pt; text-transform: uppercase;'>DANH MỤC QUY TRÌNH KỸ THUẬT: ${group.name}</h1>
          ${metaBlock}${tech.contentHtml}
          <script>window.onload = function() { setTimeout(function() { window.print(); window.close(); }, 200); }</script>
        </body></html>
    `);
    printWindow.document.close();
  };

  const renderTechRow = (tech: Technique, group: Group, isGlobalSearch = false, subGroupName = '') => (
    <tr key={tech.id} className="hover:bg-slate-50 transition-colors group/row border-b border-slate-100 last:border-0">
      <td className="px-6 py-4">
        {renamingTechId === tech.id ? (
          <div className="flex items-center gap-2">
            <input autoFocus type="text" value={newTechName} onChange={e => setNewTechName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveRenamedTech()} className="border border-blue-400 rounded px-2 py-1 outline-none w-full max-w-sm focus:ring-2 focus:ring-blue-100" />
            <button onClick={saveRenamedTech} className="p-1.5 bg-green-100 text-green-600 rounded hover:bg-green-600 hover:text-white"><Check size={16}/></button>
            <button onClick={() => setRenamingTechId(null)} className="p-1.5 bg-slate-100 text-slate-600 rounded hover:bg-slate-300"><X size={16}/></button>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-3">
              <span className="font-semibold text-slate-800">{tech.name}</span>
              <button onClick={() => startRenaming(tech)} className="opacity-0 group-hover/row:opacity-100 p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-all"><Pencil size={14} /></button>
            </div>
            {isGlobalSearch && (
              <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-500 font-medium"><MapPin size={12} className="text-slate-400" /><span className="bg-slate-100 px-2 py-0.5 rounded">{group.name}</span> / <span className="bg-slate-100 px-2 py-0.5 rounded">{subGroupName}</span></div>
            )}
          </div>
        )}
      </td>
      <td className="px-6 py-4 text-center">
        {tech.isExtracted ? <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-[11px] font-bold inline-flex items-center gap-1"><CheckCircle2 size={12}/> Có dữ liệu</span> : <span className="bg-slate-100 text-slate-500 px-3 py-1 rounded-full text-[11px] font-bold inline-flex items-center gap-1"><AlertCircle size={12}/> Đang trống</span>}
      </td>
      <td className="px-6 py-4 text-right">
        <div className="flex items-center justify-end gap-2">
          <button onClick={() => openEditor(tech)} className={cn("p-2 rounded-lg transition-colors", tech.isExtracted ? "bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white" : "bg-amber-50 text-amber-600 hover:bg-amber-600 hover:text-white")} title={tech.isExtracted ? "Xem/Sửa" : "Tạo thủ công"}>{tech.isExtracted ? <Edit size={16} /> : <FilePlus size={16} />}</button>
          <button onClick={() => exportSingleToWord(tech, group)} disabled={!tech.isExtracted} className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-600 hover:text-white disabled:opacity-30"><FileText size={16} /></button>
          <button onClick={() => exportSingleToPdf(tech, group)} disabled={!tech.isExtracted} className="p-2 bg-orange-50 text-orange-600 rounded-lg hover:bg-orange-600 hover:text-white disabled:opacity-30"><Printer size={16} /></button>
          <button onClick={() => deleteTechniqueGlobally(tech.id)} className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-600 hover:text-white opacity-0 group-hover/row:opacity-100 transition-opacity"><Trash2 size={16} /></button>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="min-h-screen bg-slate-100 flex font-sans text-slate-900">
      <div className="w-80 bg-white border-r border-slate-200 flex flex-col shadow-sm z-10 select-none">
        <div className="p-6 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3 mb-6"><div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-blue-200"><Database size={20} /></div><div><h1 className="text-xl font-bold text-slate-900 leading-tight">MedFlow Cloud</h1><p className="text-slate-500 text-[11px] font-medium uppercase tracking-wider">Hệ thống Quản lý Quy trình</p></div></div>
          <div className="relative mb-4"><div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Search className="h-4 w-4 text-slate-400" /></div><input type="text" placeholder="Tìm mọi thứ ở đây..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none w-full bg-slate-50 transition-all shadow-inner"/>{searchInput && <button onClick={() => setSearchInput('')} className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>}</div>
          <div className="flex gap-2 mb-4"><button onClick={syncToCloud} disabled={isProcessing} className="flex-1 flex items-center justify-center gap-2 bg-green-50 text-green-600 font-bold py-2 rounded-xl hover:bg-green-600 hover:text-white transition-colors">{isProcessing ? <Loader2 size={16} className="animate-spin" /> : <CloudUpload size={16}/>}{isProcessing ? "Đang xử lý..." : "Lưu lên Cloud"}</button></div>
          <form onSubmit={handleAddGroup} className="relative"><input type="text" placeholder="Tạo Nhóm lớn mới..." value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"/><button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-600 hover:text-white transition-colors"><Plus size={16} /></button></form>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {groups?.map((group, index) => (
            <div key={group.id} className="mb-2">
              <div onClick={() => { if(renamingGroupId !== group.id) toggleGroup(group.id); }} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 cursor-pointer group/header transition-colors">
                <div className="flex items-center gap-2 text-slate-800 font-bold flex-1 overflow-hidden">
                  {expandedGroups.includes(group.id) ? <ChevronDown size={18} className="text-slate-400 shrink-0"/> : <ChevronRight size={18} className="text-slate-400 shrink-0"/>}
                  <Folder size={18} className="text-blue-500 shrink-0" />
                  {renamingGroupId === group.id ? (
                    <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}><input autoFocus type="text" value={editGroupName} onChange={e => setEditGroupName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveRenamedGroup()} className="border border-blue-400 rounded px-2 py-1 outline-none w-full text-sm font-normal focus:ring-2 focus:ring-blue-100" /><button onClick={saveRenamedGroup} className="p-1 bg-green-100 text-green-600 rounded hover:bg-green-600 hover:text-white"><Check size={14}/></button><button onClick={() => setRenamingGroupId(null)} className="p-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-300"><X size={14}/></button></div>
                  ) : (<span className="truncate">{group.name}</span>)}
                </div>
                {renamingGroupId !== group.id && (
                  <div className="flex items-center gap-1 opacity-0 group-hover/header:opacity-100 transition-opacity shrink-0 ml-2">
                    {index > 0 && <button onClick={(e) => { e.stopPropagation(); moveGroupUp(index); }} className="p-1 hover:bg-slate-200 text-slate-600 rounded" title="Đẩy lên trên"><ArrowUp size={14}/></button>}
                    {index < groups.length - 1 && <button onClick={(e) => { e.stopPropagation(); moveGroupDown(index); }} className="p-1 hover:bg-slate-200 text-slate-600 rounded" title="Kéo xuống dưới"><ArrowDown size={14}/></button>}
                    <button onClick={(e) => { e.stopPropagation(); startRenamingGroup(group); }} className="p-1.5 hover:bg-amber-100 text-amber-600 rounded-lg" title="Đổi tên Nhóm"><Pencil size={14}/></button>
                    <button onClick={(e) => { e.stopPropagation(); setEditingGroupMeta(group); }} className="p-1.5 hover:bg-slate-200 text-slate-600 rounded-lg" title="Cập nhật Quyết định"><Settings size={14}/></button>
                    <button onClick={(e) => { e.stopPropagation(); setAddingSubGroupTo(group.id); if (!expandedGroups.includes(group.id)) toggleGroup(group.id); }} className="p-1.5 hover:bg-blue-100 text-blue-600 rounded-lg" title="Thêm nhóm nhỏ"><Plus size={14}/></button>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.id); }} className="p-1.5 hover:bg-red-100 text-red-500 rounded-lg" title="Xóa toàn bộ"><Trash2 size={14}/></button>
                  </div>
                )}
              </div>

              <AnimatePresence>
                {expandedGroups.includes(group.id) && (
                  <motion.div initial={{height: 0, opacity: 0}} animate={{height: 'auto', opacity: 1}} exit={{height: 0, opacity: 0}} className="overflow-hidden">
                    <div className="pl-9 pr-2 py-1 space-y-1 relative before:absolute before:left-[21px] before:top-0 before:bottom-2 before:w-px before:bg-slate-200">
                      {group.subGroups?.map(sg => (
                        <div key={sg.id} onClick={() => { if(renamingSubGroupId !== sg.id) { setActiveIds({groupId: group.id, subGroupId: sg.id}); setSearchInput(''); } }} className={cn("flex items-center justify-between p-2 rounded-lg cursor-pointer group/item transition-colors text-sm relative before:absolute before:left-[-15px] before:top-1/2 before:w-[15px] before:h-px before:bg-slate-200", activeIds.subGroupId === sg.id && !searchInput ? "bg-blue-50 border border-blue-200 text-blue-700 font-bold shadow-sm" : "hover:bg-slate-50 text-slate-600 border border-transparent font-medium")}>
                          <div className="flex items-center gap-2 flex-1 overflow-hidden">
                            <FolderOpen size={16} className={cn("shrink-0", activeIds.subGroupId === sg.id && !searchInput ? "text-blue-600" : "text-slate-400")} />
                            {renamingSubGroupId === sg.id ? (
                              <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}><input autoFocus type="text" value={editSubGroupName} onChange={e => setEditSubGroupName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveRenamedSubGroup(group.id)} className="border border-blue-400 rounded px-2 py-1 outline-none w-full text-xs font-normal focus:ring-2 focus:ring-blue-100" /><button onClick={() => saveRenamedSubGroup(group.id)} className="p-1 bg-green-100 text-green-600 rounded hover:bg-green-600 hover:text-white"><Check size={12}/></button><button onClick={() => setRenamingSubGroupId(null)} className="p-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-300"><X size={12}/></button></div>
                            ) : (<span className="truncate">{sg.name}</span>)}
                          </div>
                          {renamingSubGroupId !== sg.id && (
                            <div className="flex items-center gap-1 shrink-0 ml-2">
                              <span className="text-[10px] bg-white border border-slate-200 px-1.5 py-0.5 rounded-full text-slate-500">{sg.techniques?.length || 0}</span>
                              <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                <button onClick={(e) => { e.stopPropagation(); startRenamingSubGroup(sg); }} className="p-1 text-amber-500 hover:bg-amber-100 rounded"><Pencil size={12}/></button>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteSubGroup(group.id, sg.id); }} className="p-1 text-red-400 hover:bg-red-100 rounded"><Trash2 size={12}/></button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      {addingSubGroupTo === group.id && (
                        <div className="p-2 relative before:absolute before:left-[-15px] before:top-1/2 before:w-[15px] before:h-px before:bg-slate-200"><input autoFocus value={newSubGroupName} onChange={e => setNewSubGroupName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveNewSubGroup(group.id)} onBlur={() => { if(newSubGroupName) saveNewSubGroup(group.id); else setAddingSubGroupTo(null); }} className="w-full border border-blue-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 ring-blue-100" placeholder="Tên nhóm nhỏ..." /></div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>

      {/* WORKSPACE CHÍNH */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-slate-50/50 relative">
        <div className="absolute top-5 right-8 z-20 flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-slate-200 shadow-sm"><span className="text-sm font-medium text-slate-600">Kèm Số QĐ khi tải file:</span><button onClick={() => setIncludeExportMeta(!includeExportMeta)} className={cn("w-10 h-5 rounded-full relative transition-colors", includeExportMeta ? "bg-blue-600" : "bg-slate-300")}><div className={cn("w-3.5 h-3.5 bg-white rounded-full absolute top-[3px] transition-transform", includeExportMeta ? "left-[22px]" : "left-[3px]")} /></button></div>

        {searchInput ? (
          <div className="flex-1 flex flex-col pt-20 px-8 pb-8 overflow-y-auto">
            <div className="mb-6"><h2 className="text-3xl font-extrabold text-slate-800 flex items-center gap-3"><Search className="text-blue-600" size={32} /> Kết quả tìm kiếm</h2><p className="text-slate-500 mt-2">Tìm thấy <strong className="text-blue-600">{globalSearchResults.length}</strong> kỹ thuật</p></div>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              {globalSearchResults.length === 0 ? ( <div className="p-12 text-center text-slate-400"><Search size={48} className="mx-auto mb-4 opacity-20" /><p>Không tìm thấy kết quả nào.</p></div> ) : (
                <table className="w-full text-left border-collapse"><thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-bold tracking-wider"><tr><th className="px-6 py-4">Tên Kỹ thuật & Vị trí</th><th className="px-6 py-4 w-32 text-center">Trạng thái</th><th className="px-6 py-4 w-64 text-right">Thao tác</th></tr></thead><tbody>{globalSearchResults.map((result) => renderTechRow(result, result.group, true, result.subGroup.name))}</tbody></table>
              )}
            </div>
          </div>
        ) : activeSubGroup && activeGroup ? (
          <>
            <div className="bg-white px-8 pt-8 pb-5 border-b border-slate-200 shrink-0 pr-48"><p className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">{activeGroup.name}</p><h2 className="text-3xl font-extrabold text-slate-800 flex items-center gap-3"><FolderOpen className="text-blue-500" size={32}/> {activeSubGroup.name}</h2><p className="text-sm text-slate-500 mt-1">Thư mục có {activeSubGroup.techniques?.length || 0} kỹ thuật • {activeSubGroup.techniques?.filter(t => t.isExtracted).length || 0} đã nạp nội dung</p></div>
            <div className="flex-1 overflow-y-auto p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-slate-700 text-lg">Bảng điều khiển</h3>
                <div className="flex gap-3">
                  <button onClick={handleDeleteAllTechsInFolder} disabled={!activeSubGroup.techniques || activeSubGroup.techniques.length === 0} className="flex items-center gap-2 bg-red-50 hover:bg-red-600 text-red-600 hover:text-white px-4 py-2 rounded-xl font-bold transition-all disabled:opacity-50 text-sm"><Trash2 size={16} /> Làm sạch thư mục</button>
                  <button onClick={exportGroupToWord} disabled={!activeSubGroup.techniques || activeSubGroup.techniques.length === 0} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-bold shadow-md transition-all active:scale-95 disabled:opacity-50 text-sm"><FileDown size={16} /> Tải file Word Nhóm</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-6 mb-8">
                <div {...excelDrop.getRootProps()} className="bg-white border-2 border-dashed border-green-200 p-6 rounded-2xl hover:border-green-400 hover:bg-green-50 cursor-pointer transition-all flex items-center gap-4 shadow-sm"><input {...excelDrop.getInputProps()} /><div className="p-3 bg-green-100 text-green-600 rounded-xl"><Stethoscope size={24} /></div><div><h3 className="font-bold text-slate-800">1. Nạp danh sách (Excel)</h3><p className="text-xs text-slate-500 mt-1">Lọc trùng lặp thông minh</p></div></div>
                <div {...wordDrop.getRootProps()} className="bg-white border-2 border-dashed border-blue-200 p-6 rounded-2xl hover:border-blue-400 hover:bg-blue-50 cursor-pointer transition-all flex items-center gap-4 shadow-sm"><input {...wordDrop.getInputProps()} />{isProcessing ? <div className="p-3 bg-blue-100 text-blue-600 rounded-xl"><Loader2 size={24} className="animate-spin" /></div> : <div className="p-3 bg-blue-100 text-blue-600 rounded-xl"><FileText size={24} /></div>}<div><h3 className="font-bold text-slate-800">2. Nạp Nội dung BYT (Word)</h3><p className="text-xs text-slate-500 mt-1">Quét bằng Lõi Nhận diện Chuỗi Mờ</p></div></div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {!currentFolderTechniques || currentFolderTechniques.length === 0 ? ( <div className="p-12 text-center text-slate-400"><Database size={48} className="mx-auto mb-4 opacity-20" /><p>Thư mục này đang trống. Hãy kéo thả file Excel vào nhé!</p></div> ) : (
                  <table className="w-full text-left border-collapse"><thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-bold tracking-wider"><tr><th className="px-6 py-4">Tên Kỹ thuật</th><th className="px-6 py-4 w-32 text-center">Trạng thái</th><th className="px-6 py-4 w-64 text-right">Thao tác</th></tr></thead><tbody>{currentFolderTechniques.map((tech) => renderTechRow(tech, activeGroup, false))}</tbody></table>
                )}
              </div>
            </div>
          </>
        ) : ( <div className="flex-1 flex items-center justify-center text-slate-400 pt-20"><div className="text-center"><FolderOpen size={64} className="mx-auto mb-4 opacity-20" /><p className="text-lg">Chọn một Thư mục nhỏ ở cột bên trái</p></div></div> )}
      </div>

      {/* MODAL TRÌNH SOẠN THẢO */}
      <AnimatePresence>
        {editingTech && (
          <motion.div initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div initial={{scale: 0.95, opacity: 0, y: 20}} animate={{scale: 1, opacity: 1, y: 0}} exit={{scale: 0.95, opacity: 0, y: 20}} className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden">
              <div className="px-8 py-5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-3"><Edit className="text-blue-600" /> Trình soạn thảo: {stripPrefixNumber(editingTech.name)}</h3>
                <div className="flex items-center gap-3"><button onClick={() => { handleSaveEdit(); }} className="flex items-center gap-2 bg-green-600 text-white px-5 py-2 rounded-xl font-bold hover:bg-green-700 transition-colors"><Save size={18} /> Lưu dữ liệu</button><button onClick={() => setEditingTech(null)} className="p-2 bg-white text-slate-400 hover:bg-red-50 hover:text-red-600 rounded-xl border border-slate-200"><X size={20} /></button></div>
              </div>
              <div className="flex-1 p-8 bg-slate-100 overflow-y-auto"><div className="max-w-3xl mx-auto bg-white p-12 rounded-lg shadow-sm border border-slate-200 min-h-full"><div className="prose prose-slate max-w-none focus:outline-none" contentEditable dangerouslySetInnerHTML={{ __html: editContent }} onBlur={(e) => setEditContent(e.currentTarget.innerHTML)} style={{fontFamily: "'Times New Roman', serif", fontSize: '14pt', lineHeight: 1.5, textAlign: 'justify'}} /></div></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL CÀI ĐẶT NHÓM */}
      <AnimatePresence>
        {editingGroupMeta && (
          <motion.div initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div initial={{scale: 0.95, opacity: 0, y: 20}} animate={{scale: 1, opacity: 1, y: 0}} exit={{scale: 0.95, opacity: 0, y: 20}} className="bg-white rounded-3xl shadow-xl w-full max-w-md p-6 overflow-hidden">
              <div className="flex justify-between items-center mb-6"><h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Settings className="text-blue-600" size={20}/> Thông tin Nhóm</h3><button onClick={() => setEditingGroupMeta(null)} className="text-slate-400 hover:text-red-500"><X size={20}/></button></div>
              <div className="space-y-4">
                <div><label className="block text-sm font-bold text-slate-700 mb-1">Tên Nhóm Lớn</label><input type="text" value={editingGroupMeta.name} onChange={e => setEditingGroupMeta({...editingGroupMeta, name: e.target.value})} className="w-full border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-blue-500/50 outline-none" disabled /></div>
                <div><label className="block text-sm font-bold text-slate-700 mb-1">Số Quyết định</label><input type="text" placeholder="VD: 25/QĐ-BYT" value={editingGroupMeta.decisionNum || ''} onChange={e => setEditingGroupMeta({...editingGroupMeta, decisionNum: e.target.value})} className="w-full border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-blue-500/50 outline-none" /></div>
                <div><label className="block text-sm font-bold text-slate-700 mb-1">Ngày ban hành</label><input type="text" placeholder="VD: 03/01/2014" value={editingGroupMeta.issueDate || ''} onChange={e => setEditingGroupMeta({...editingGroupMeta, issueDate: e.target.value})} className="w-full border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-blue-500/50 outline-none" /></div>
              </div>
              <div className="mt-8 flex justify-end gap-3"><button onClick={() => setEditingGroupMeta(null)} className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button><button onClick={saveGroupMeta} className="px-6 py-2 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl">Lưu lại</button></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}