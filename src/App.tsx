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
  ArrowUp, ArrowDown, Menu, Lock, Unlock, Eye
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

// ============================================================================
// 🔥 LOGIC VIP PRO: ĐỌC TỪNG DÒNG + ÉP KIỂU KHOẢNG TRẮNG ẢO (NBSP)
// ============================================================================
const getExecutionTime = (html: string) => {
  if (!html) return "Chưa có nội dung";
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Lấy tất cả các dòng văn bản (paragraph, list item, table cell)
    const elements = Array.from(doc.body.querySelectorAll('p, div, li, td, h1, h2, h3, h4'));
    
    for (const el of elements) {
      // ÉP KIỂU: Biến mọi khoảng trắng ảo (tab, newline, &nbsp;) thành 1 khoảng trắng chuẩn duy nhất
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      
      // Lọc rác: Thời gian thực hiện chỉ nằm trên 1 dòng ngắn (dưới 250 ký tự)
      if (!text || text.length > 250) continue;
      
      const lowerText = text.toLowerCase();
      
      // Nếu dòng này chứa đúng từ khóa
      if (lowerText.includes('thời gian thực hiện') || lowerText.includes('thời gian tiến hành')) {
        
        // Tách đôi câu bằng dấu hai chấm ":"
        const parts = text.split(':');
        if (parts.length > 1) {
          // Lấy toàn bộ phần đuôi sau dấu hai chấm
          let timeString = parts.slice(1).join(':').trim();
          // Quét sạch dấu chấm kết câu nếu có
          timeString = timeString.replace(/\.$/, '');
          
          if (timeString) return `⏳ Thời gian: ${timeString}`;
        } else {
          // Đề phòng bác sĩ quên gõ dấu ":"
          const match = text.match(/(?:thời gian thực hiện(?: kỹ thuật)?|thời gian tiến hành)\s*(.*)/i);
          if (match && match[1]) {
            return `⏳ Thời gian: ${match[1].trim().replace(/\.$/, '')}`;
          }
        }
      }
    }
    return "⏳ Chưa xác định được thời gian";
  } catch (e) {
    return "⏳ Lỗi đọc dữ liệu";
  }
};
// ============================================================================

// --- KIỂU DỮ LIỆU ---
interface Technique { id: string; name: string; contentHtml: string; isExtracted: boolean; }
interface SubGroup { id: string; name: string; order?: number; techniques: Technique[]; }
interface Group { id: string; name: string; decisionNum?: string; issueDate?: string; effectiveDate?: string; order?: number; subGroups: SubGroup[]; }
interface SearchResult extends Technique { group: Group; subGroup: SubGroup; }

export default function App() {
  const [isAdmin, setIsAdmin] = useState(false); 
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false); 

  const handleAdminLogin = () => {
    if (isAdmin) {
      if (confirm("Bạn muốn khóa quyền Quản trị (Trở về chế độ xem)?")) setIsAdmin(false);
      return;
    }
    const pwd = prompt("NHẬP MẬT KHẨU QUẢN TRỊ VIÊN:");
    if (pwd === "Cuulong@2026") { 
      setIsAdmin(true);
      alert("Mở khóa thành công! Các chức năng chỉnh sửa đã hiện ra.");
    } else if (pwd !== null) {
      alert("Sai mật khẩu!");
    }
  };

  const [groups, setGroups] = useState<Group[]>(() => {
    const savedData = localStorage.getItem('medflow_local_backup');
    if (savedData) {
      try { 
        const parsed = JSON.parse(savedData); 
        if (Array.isArray(parsed)) return parsed; 
      } catch (e) {}
    }
    return [
      { id: 'g1', name: 'Chẩn đoán hình ảnh', decisionNum: '', issueDate: '', effectiveDate: '', order: 0, subGroups: [] }
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

  const activeGroup = groups?.find(g => g.id === activeIds.groupId);
  const activeSubGroup = activeGroup?.subGroups?.find(sg => sg.id === activeIds.subGroupId);

  useEffect(() => {
    try {
      localStorage.setItem('medflow_local_backup', JSON.stringify(groups || []));
    } catch (error) {
      console.warn("Bộ nhớ trình duyệt đầy, vui lòng lưu lên Cloud thường xuyên.");
    }
  }, [groups]);

  // --- TẢI DATA TỪ FIREBASE ---
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
            fetchedGroups.push({ id: data.id, name: data.name, decisionNum: data.decisionNum, issueDate: data.issueDate, effectiveDate: data.effectiveDate, order: data.order || 0, subGroups: [] });
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
          const masterDocRef = doc(db, "medflow", "master_data");
          const masterSnap = await getDoc(masterDocRef);
          if (masterSnap.exists()) {
            const oldData = masterSnap.data().groups;
            if (oldData && Array.isArray(oldData)) {
              fetchedGroups.push(...oldData);
            }
          }
        }

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
        currentBatch.set(doc(groupsCol, group.id), { id: group.id, name: group.name, decisionNum: group.decisionNum || '', issueDate: group.issueDate || '', effectiveDate: group.effectiveDate || '', order: gIndex });
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

  const extractTechniqueLogic = (children: Element[], normalizedTexts: string[], techName: string) => {
    const BYT_SECTIONS_NORM = [
      "dai cuong", "chi dinh", "chong chi dinh", "than trong", "chuan bi", "tien hanh", "theo doi", "tai bien",
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
          const isAllUpper = (textAfterNumber === textAfterNumber.toUpperCase() && textAfterNumber.length > 5);
          const textAfterNumNorm = normalizeVN(textAfterNumber);
          const isBytSection = BYT_SECTIONS_NORM.some(section => textAfterNumNorm.includes(section));
          if (isAllUpper && !isBytSection) { endIndex = i; break; }
        }
      }
      return { content: children.slice(startIndex, endIndex).map(el => el.outerHTML).join(''), success: true };
    }
    return { content: '', success: false };
  };

  const openEditor = (tech: Technique) => {
    setEditingTech(tech);
    if (tech.isExtracted && tech.contentHtml) {
      setEditContent(tech.contentHtml);
    } else if (isAdmin) {
      setEditContent(`<h1 style='text-align: center; font-size: 16pt; font-weight: bold; text-transform: uppercase;'>${stripPrefixNumber(tech.name)}</h1><p><strong>1. ĐẠI CƯƠNG</strong></p><p><br></p><p><strong>2. CHỈ ĐỊNH</strong></p><p><br></p><p><strong>3. CHỐNG CHỈ ĐỊNH</strong></p><p><br></p><p><strong>4. THẬN TRỌNG</strong></p><p><br></p><p><strong>5. CHUẨN BỊ</strong></p><p><br></p><p><strong>6. CÁC BƯỚC TIẾN HÀNH</strong></p><p><br></p><p><strong>7. THEO DÕI VÀ XỬ TRÍ TAI BIẾN</strong></p><p><br></p>`);
    }
  };

  const handleSaveEdit = () => { if (!editingTech) return; updateTechniqueGlobally(editingTech.id, t => ({ ...t, contentHtml: editContent, isExtracted: true })); setEditingTech(null); };
  const toggleGroup = (id: string) => setExpandedGroups(prev => prev.includes(id) ? prev.filter(gId => gId !== id) : [...prev, id]);
  const handleAddGroup = (e: React.FormEvent) => { e.preventDefault(); if (!newGroupName.trim()) return; const newGroup: Group = { id: `g-${Date.now()}`, name: newGroupName.trim(), decisionNum: '', issueDate: '', effectiveDate: '', order: groups?.length || 0, subGroups: [] }; setGroups([...(groups||[]), newGroup]); setExpandedGroups([...expandedGroups, newGroup.id]); setNewGroupName(''); };
  const saveGroupMeta = () => { if (!editingGroupMeta) return; setGroups(prev => prev.map(g => g.id === editingGroupMeta.id ? { ...g, name: editingGroupMeta.name, decisionNum: editingGroupMeta.decisionNum, issueDate: editingGroupMeta.issueDate, effectiveDate: editingGroupMeta.effectiveDate } : g)); setEditingGroupMeta(null); };
  const handleDeleteGroup = (id: string) => { if (confirm("Xóa Nhóm lớn này?")) { setGroups((groups||[]).filter(g => g.id !== id)); if (activeIds.groupId === id) setActiveIds({groupId: null, subGroupId: null}); } };
  const saveNewSubGroup = (groupId: string) => { if (newSubGroupName.trim()) { const newSg: SubGroup = { id: `sg-${Date.now()}`, name: newSubGroupName.trim(), order: groups.find(g=>g.id===groupId)?.subGroups?.length || 0, techniques: [] }; setGroups(prev => prev.map(g => g.id === groupId ? { ...g, subGroups: [...(g.subGroups||[]), newSg] } : g)); setActiveIds({groupId, subGroupId: newSg.id}); setSearchInput(''); setIsMobileMenuOpen(false); } setAddingSubGroupTo(null); setNewSubGroupName(''); };
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
    if (extractedTechs.length === 0) return alert("Thư mục này chưa có dữ liệu để tải!");
    saveAs(new Blob(['\ufeff', getDocumentHeaderHtml(activeGroup.name, activeGroup) + extractedTechs.map(t => t.contentHtml).join("<br clear=all style='mso-special-character:line-break;page-break-before:always'>") + "</body></html>"], { type: 'application/msword' }), `Quy_Trinh_${activeSubGroup.name.replace(/\s+/g, '_')}.doc`);
  };

  const exportMainGroupToWord = (group: Group, e: React.MouseEvent) => {
    e.stopPropagation(); 
    const allTechs = group.subGroups?.flatMap(sg => sg.techniques).filter(t => t.isExtracted) || [];
    if (allTechs.length === 0) return alert("Nhóm lớn này chưa có kỹ thuật nào được nạp nội dung!");

    let combinedHtml = getDocumentHeaderHtml(group.name, group);
    group.subGroups.forEach(sg => {
      const extractedSgTechs = sg.techniques?.filter(t => t.isExtracted) || [];
      if (extractedSgTechs.length > 0) {
          combinedHtml += `<h2 style='text-align: center; font-size: 15pt; font-weight: bold; margin-top: 20pt; margin-bottom: 10pt; color: #2563eb;'>--- ${sg.name.toUpperCase()} ---</h2>`;
          combinedHtml += extractedSgTechs.map(t => t.contentHtml).join("<br clear=all style='mso-special-character:line-break;page-break-before:always'>");
          combinedHtml += "<br clear=all style='mso-special-character:line-break;page-break-before:always'>";
      }
    });
    combinedHtml += "</body></html>";

    saveAs(new Blob(['\ufeff', combinedHtml], { type: 'application/msword' }), `Quy_Trinh_Nhom_${group.name.replace(/\s+/g, '_')}.doc`);
  };

  const exportSingleToWord = (tech: Technique, group: Group) => { saveAs(new Blob(['\ufeff', getDocumentHeaderHtml(group.name, group) + tech.contentHtml + "</body></html>"], { type: 'application/msword' }), `${stripPrefixNumber(tech.name).replace(/\s+/g, '_')}.doc`); };
  const exportSingleToPdf = (tech: Technique, group: Group) => {
    const printWindow = window.open('', '_blank', 'height=800,width=800');
    if (!printWindow) return alert("Vui lòng cho phép trình duyệt hiển thị Pop-up để in!");
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
      <td className="px-4 md:px-6 py-4">
        {renamingTechId === tech.id && isAdmin ? (
          <div className="flex items-center gap-2">
            <input autoFocus type="text" value={newTechName} onChange={e => setNewTechName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveRenamedTech()} className="border border-blue-400 rounded px-2 py-1 outline-none w-full max-w-sm focus:ring-2 focus:ring-blue-100 text-sm" />
            <button onClick={saveRenamedTech} className="p-1.5 bg-green-100 text-green-600 rounded hover:bg-green-600 hover:text-white shrink-0"><Check size={16}/></button>
            <button onClick={() => setRenamingTechId(null)} className="p-1.5 bg-slate-100 text-slate-600 rounded hover:bg-slate-300 shrink-0"><X size={16}/></button>
          </div>
        ) : (
          <div>
            <div className="flex items-start md:items-center gap-2 flex-col md:flex-row">
              <span className="font-semibold text-slate-800 text-sm md:text-base leading-snug cursor-help border-b border-dotted border-slate-400" title={getExecutionTime(tech.contentHtml)}>{tech.name}</span>
              {isAdmin && <button onClick={() => startRenaming(tech)} className="opacity-0 group-hover/row:opacity-100 p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-all hidden md:block"><Pencil size={14} /></button>}
            </div>
            
            {isGlobalSearch && (
              <div className="mt-2 flex flex-col gap-1.5 text-[10px] md:text-[11px] text-slate-500 font-medium">
                <div className="flex flex-wrap items-center gap-1">
                  <MapPin size={12} className="text-slate-400 shrink-0" />
                  <span className="bg-slate-100 px-2 py-0.5 rounded shadow-sm">{group.name}</span> / <span className="bg-slate-100 px-2 py-0.5 rounded shadow-sm">{subGroupName}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 ml-4">
                  <span className="bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-md">QĐ: <b className="font-bold">{group.decisionNum || '---'}</b></span>
                  <span className="bg-green-50 text-green-700 border border-green-100 px-2 py-0.5 rounded-md">Ban hành: <b className="font-bold">{group.issueDate || '---'}</b></span>
                  <span className="bg-purple-50 text-purple-700 border border-purple-100 px-2 py-0.5 rounded-md">Hiệu lực: <b className="font-bold">{group.effectiveDate || '---'}</b></span>
                </div>
              </div>
            )}
          </div>
        )}
      </td>
      <td className="px-4 md:px-6 py-4 text-center">
        {tech.isExtracted ? <span className="bg-green-100 text-green-700 px-2 py-1 md:px-3 rounded-full text-[10px] md:text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap"><CheckCircle2 size={12}/> <span className="hidden md:inline">Có dữ liệu</span></span> : <span className="bg-slate-100 text-slate-500 px-2 py-1 md:px-3 rounded-full text-[10px] md:text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap"><AlertCircle size={12}/> <span className="hidden md:inline">Đang trống</span></span>}
      </td>
      <td className="px-4 md:px-6 py-4 text-right">
        <div className="flex items-center justify-end gap-1 md:gap-2">
          
          {(isAdmin || tech.isExtracted) && (
            <button onClick={() => openEditor(tech)} className={cn("p-1.5 md:p-2 rounded-lg transition-colors shadow-sm", tech.isExtracted ? "bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white border border-blue-100" : "bg-amber-50 text-amber-600 hover:bg-amber-600 hover:text-white border border-amber-100")} title={isAdmin && tech.isExtracted ? "Xem và Chỉnh sửa" : isAdmin ? "Tạo thủ công" : "Xem chi tiết"}>
              {isAdmin && !tech.isExtracted ? <FilePlus size={16} /> : isAdmin ? <Edit size={16} /> : <Eye size={16} />}
            </button>
          )}

          {tech.isExtracted && (
            <>
              <button onClick={() => exportSingleToWord(tech, group)} className="p-1.5 md:p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-600 hover:text-white transition-colors shadow-sm border border-indigo-100" title="Tải file Word"><FileText size={16} /></button>
              <button onClick={() => exportSingleToPdf(tech, group)} className="p-1.5 md:p-2 bg-orange-50 text-orange-600 rounded-lg hover:bg-orange-600 hover:text-white transition-colors shadow-sm border border-orange-100" title="In / Tải PDF"><Printer size={16} /></button>
            </>
          )}

          {isAdmin && (
            <button onClick={() => deleteTechniqueGlobally(tech.id)} className="p-1.5 md:p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-600 hover:text-white opacity-100 md:opacity-0 group-hover/row:opacity-100 transition-opacity border border-red-100" title="Xóa"><Trash2 size={16} /></button>
          )}
        </div>
      </td>
    </tr>
  );

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col md:flex-row font-sans text-slate-900">
      
      {/* HEADER CHO MOBILE */}
      <div className="md:hidden flex items-center justify-between bg-white p-4 border-b border-slate-200 shadow-sm z-20">
        <div className="flex items-center gap-3">
          <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-lg"><Menu size={24}/></button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-sm"><Database size={16} /></div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight"></h1>
          </div>
        </div>
      </div>

      {/* MÀN ĐEN LÀM MỜ NỀN KHI MỞ MENU MOBILE */}
      {isMobileMenuOpen && <div className="fixed inset-0 bg-slate-900/50 z-30 md:hidden" onClick={() => setIsMobileMenuOpen(false)} />}

      {/* SIDEBAR CÂY THƯ MỤC VÀ TÌM KIẾM */}
      <div className={cn("fixed inset-y-0 left-0 z-40 w-[280px] md:w-80 bg-white border-r border-slate-200 flex flex-col shadow-2xl md:shadow-sm transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0", isMobileMenuOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="p-6 border-b border-slate-100 shrink-0">
          <div className="hidden md:flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-blue-200"><Database size={20} /></div>
            <div><h1 className="text-xl font-bold text-slate-900 leading-tight">MedFlow Claud</h1><p className="text-slate-500 text-[11px] font-medium uppercase tracking-wider">Hệ thống Quản lý Quy trình</p></div>
          </div>

          <div className="relative mb-4">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Search className="h-4 w-4 text-slate-400" /></div>
            <input type="text" placeholder="Tìm kiếm nhanh..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none w-full bg-slate-50 transition-all shadow-inner"/>
            {searchInput && <button onClick={() => setSearchInput('')} className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>}
          </div>

          {isAdmin && (
            <div className="flex gap-2 mb-4">
              <button onClick={syncToCloud} disabled={isProcessing} className="flex-1 flex items-center justify-center gap-2 bg-green-50 text-green-600 font-bold py-2.5 rounded-xl hover:bg-green-600 hover:text-white transition-colors text-sm">
                {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <CloudUpload size={16}/>}
                {isProcessing ? "Đang đồng bộ..." : "Lưu lên Cloud"}
              </button>
            </div>
          )}

          {isAdmin && (
            <form onSubmit={handleAddGroup} className="relative">
              <input type="text" placeholder="Tạo Nhóm lớn mới..." value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"/>
              <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-600 hover:text-white transition-colors"><Plus size={16} /></button>
            </form>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 pb-24 md:pb-24">
          {groups?.map((group, index) => (
            <div key={group.id} className="mb-2">
              <div onClick={() => { if(renamingGroupId !== group.id) toggleGroup(group.id); }} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 cursor-pointer group/header transition-colors">
                <div className="flex items-center gap-2 text-slate-800 font-bold flex-1 overflow-hidden">
                  {expandedGroups.includes(group.id) ? <ChevronDown size={18} className="text-slate-400 shrink-0"/> : <ChevronRight size={18} className="text-slate-400 shrink-0"/>}
                  <Folder size={18} className="text-blue-500 shrink-0" />
                  {renamingGroupId === group.id && isAdmin ? (
                    <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}><input autoFocus type="text" value={editGroupName} onChange={e => setEditGroupName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveRenamedGroup()} className="border border-blue-400 rounded px-2 py-1 outline-none w-full text-sm font-normal focus:ring-2 focus:ring-blue-100" /><button onClick={saveRenamedGroup} className="p-1 bg-green-100 text-green-600 rounded hover:bg-green-600 hover:text-white"><Check size={14}/></button><button onClick={() => setRenamingGroupId(null)} className="p-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-300"><X size={14}/></button></div>
                  ) : (<span className="truncate text-sm md:text-base">{group.name}</span>)}
                </div>
                
                <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover/header:opacity-100 transition-opacity shrink-0 ml-2">
                  <button onClick={(e) => exportMainGroupToWord(group, e)} className="p-1.5 hover:bg-blue-100 text-blue-600 rounded-lg shadow-sm border border-blue-50" title="Tải toàn bộ file Word Nhóm lớn"><FileDown size={14}/></button>
                  
                  {isAdmin && (
                    <>
                      {index > 0 && <button onClick={(e) => { e.stopPropagation(); moveGroupUp(index); }} className="p-1 hover:bg-slate-200 text-slate-600 rounded hidden md:block" title="Đẩy lên"><ArrowUp size={14}/></button>}
                      {index < groups.length - 1 && <button onClick={(e) => { e.stopPropagation(); moveGroupDown(index); }} className="p-1 hover:bg-slate-200 text-slate-600 rounded hidden md:block" title="Kéo xuống"><ArrowDown size={14}/></button>}
                      <button onClick={(e) => { e.stopPropagation(); startRenamingGroup(group); }} className="p-1.5 hover:bg-amber-100 text-amber-600 rounded-lg" title="Đổi tên Nhóm"><Pencil size={14}/></button>
                      <button onClick={(e) => { e.stopPropagation(); setEditingGroupMeta(group); }} className="p-1.5 hover:bg-slate-200 text-slate-600 rounded-lg hidden md:block" title="Cập nhật Quyết định"><Settings size={14}/></button>
                      <button onClick={(e) => { e.stopPropagation(); setAddingSubGroupTo(group.id); if (!expandedGroups.includes(group.id)) toggleGroup(group.id); }} className="p-1.5 hover:bg-blue-100 text-blue-600 rounded-lg" title="Thêm thư mục"><Plus size={14}/></button>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.id); }} className="p-1.5 hover:bg-red-100 text-red-500 rounded-lg hidden md:block" title="Xóa toàn bộ"><Trash2 size={14}/></button>
                    </>
                  )}
                </div>
              </div>

              <AnimatePresence>
                {expandedGroups.includes(group.id) && (
                  <motion.div initial={{height: 0, opacity: 0}} animate={{height: 'auto', opacity: 1}} exit={{height: 0, opacity: 0}} className="overflow-hidden">
                    <div className="pl-9 pr-2 py-1 space-y-1 relative before:absolute before:left-[21px] before:top-0 before:bottom-2 before:w-px before:bg-slate-200">
                      {group.subGroups?.map(sg => (
                        <div key={sg.id} onClick={() => { if(renamingSubGroupId !== sg.id) { setActiveIds({groupId: group.id, subGroupId: sg.id}); setSearchInput(''); setIsMobileMenuOpen(false); } }} className={cn("flex items-center justify-between p-2 rounded-lg cursor-pointer group/item transition-colors text-sm relative before:absolute before:left-[-15px] before:top-1/2 before:w-[15px] before:h-px before:bg-slate-200", activeIds.subGroupId === sg.id && !searchInput ? "bg-blue-50 border border-blue-200 text-blue-700 font-bold shadow-sm" : "hover:bg-slate-50 text-slate-600 border border-transparent font-medium")}>
                          <div className="flex items-center gap-2 flex-1 overflow-hidden">
                            <FolderOpen size={16} className={cn("shrink-0", activeIds.subGroupId === sg.id && !searchInput ? "text-blue-600" : "text-slate-400")} />
                            {renamingSubGroupId === sg.id && isAdmin ? (
                              <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}><input autoFocus type="text" value={editSubGroupName} onChange={e => setEditSubGroupName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveRenamedSubGroup(group.id)} className="border border-blue-400 rounded px-2 py-1 outline-none w-full text-xs font-normal focus:ring-2 focus:ring-blue-100" /><button onClick={() => saveRenamedSubGroup(group.id)} className="p-1 bg-green-100 text-green-600 rounded hover:bg-green-600 hover:text-white"><Check size={12}/></button><button onClick={() => setRenamingSubGroupId(null)} className="p-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-300"><X size={12}/></button></div>
                            ) : (<span className="truncate">{sg.name}</span>)}
                          </div>
                          {renamingSubGroupId !== sg.id && (
                            <div className="flex items-center gap-1 shrink-0 ml-2">
                              <span className="text-[10px] bg-white border border-slate-200 px-1.5 py-0.5 rounded-full text-slate-500 shadow-sm">{sg.techniques?.length || 0}</span>
                              {isAdmin && (
                                <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover/item:opacity-100 transition-opacity">
                                  <button onClick={(e) => { e.stopPropagation(); startRenamingSubGroup(sg); }} className="p-1 text-amber-500 hover:bg-amber-100 rounded"><Pencil size={12}/></button>
                                  <button onClick={(e) => { e.stopPropagation(); handleDeleteSubGroup(group.id, sg.id); }} className="p-1 text-red-400 hover:bg-red-100 rounded hidden md:block"><Trash2 size={12}/></button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                      {addingSubGroupTo === group.id && isAdmin && (
                        <div className="p-2 relative before:absolute before:left-[-15px] before:top-1/2 before:w-[15px] before:h-px before:bg-slate-200"><input autoFocus value={newSubGroupName} onChange={e => setNewSubGroupName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveNewSubGroup(group.id)} onBlur={() => { if(newSubGroupName) saveNewSubGroup(group.id); else setAddingSubGroupTo(null); }} className="w-full border border-blue-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 ring-blue-100" placeholder="Tên thư mục nhỏ..." /></div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
        
        {/* NÚT MỞ KHÓA ADMIN */}
        <div className="absolute bottom-[60px] left-4 z-50">
          <button onClick={handleAdminLogin} className={cn("p-3 rounded-full shadow-lg transition-all flex items-center justify-center text-white", isAdmin ? "bg-amber-500 hover:bg-amber-600" : "bg-slate-800 hover:bg-slate-900")} title={isAdmin ? "Đang ở chế độ Admin (Bấm để khóa)" : "Nhập mã để mở chế độ Admin"}>
            {isAdmin ? <Unlock size={18} /> : <Lock size={18} />}
          </button>
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-3 text-center bg-slate-50 border-t border-slate-200">
          <p className="text-[10px] text-slate-400 font-medium leading-tight">
            © 2026 Phát triển bởi Bill Nguyen<br/>Phòng khám Đa khoa Cửu Long
          </p>
        </div>
      </div>

      {/* WORKSPACE CHÍNH */}
      <div className="flex-1 flex flex-col md:h-screen overflow-hidden bg-slate-50/50 relative">
        
        {/* NÚT BẬT TẮT XUẤT KÈM QUYẾT ĐỊNH */}
        <div className="hidden md:flex absolute top-5 right-8 z-20 items-center gap-2 bg-white px-3 py-2 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-sm font-medium text-slate-600">Kèm Số QĐ khi tải file:</span>
          <button onClick={() => setIncludeExportMeta(!includeExportMeta)} className={cn("w-10 h-5 rounded-full relative transition-colors", includeExportMeta ? "bg-blue-600" : "bg-slate-300")}>
            <div className={cn("w-3.5 h-3.5 bg-white rounded-full absolute top-[3px] transition-transform", includeExportMeta ? "left-[22px]" : "left-[3px]")} />
          </button>
        </div>

        {searchInput ? (
          <div className="flex-1 flex flex-col pt-6 md:pt-20 px-4 md:px-8 pb-8 overflow-y-auto">
            <div className="mb-6">
              <h2 className="text-2xl md:text-3xl font-extrabold text-slate-800 flex items-center gap-3"><Search className="text-blue-600 hidden md:block" size={32} /> Kết quả tìm kiếm</h2>
              <p className="text-sm md:text-base text-slate-500 mt-1 md:mt-2">Tìm thấy <strong className="text-blue-600">{globalSearchResults.length}</strong> kỹ thuật</p>
            </div>

            <div className="bg-white rounded-xl md:rounded-2xl border border-slate-200 shadow-sm overflow-x-auto w-full">
              {globalSearchResults.length === 0 ? ( <div className="p-8 md:p-12 text-center text-slate-400"><Search size={40} className="mx-auto mb-4 opacity-20" /><p className="text-sm md:text-base">Không tìm thấy kết quả nào.</p></div> ) : (
                <table className="w-full text-left border-collapse min-w-[600px]"><thead className="bg-slate-50 border-b border-slate-200 text-[10px] md:text-xs uppercase text-slate-500 font-bold tracking-wider"><tr><th className="px-4 md:px-6 py-3 md:py-4">Tên Kỹ thuật & Vị trí</th><th className="px-4 md:px-6 py-3 md:py-4 w-24 md:w-32 text-center">Trạng thái</th><th className="px-4 md:px-6 py-3 md:py-4 w-32 md:w-64 text-right">Thao tác</th></tr></thead><tbody>{globalSearchResults.map((result) => renderTechRow(result, result.group, true, result.subGroup.name))}</tbody></table>
              )}
            </div>
          </div>
        ) : activeSubGroup && activeGroup ? (
          <>
            <div className="bg-white px-4 md:px-8 pt-6 md:pt-8 pb-4 md:pb-5 border-b border-slate-200 shrink-0 md:pr-48">
              <p className="text-[10px] md:text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">{activeGroup.name}</p>
              <h2 className="text-2xl md:text-3xl font-extrabold text-slate-800 flex items-center gap-2 md:gap-3"><FolderOpen className="text-blue-500 hidden md:block" size={28}/> {activeSubGroup.name}</h2>
              <p className="text-xs md:text-sm text-slate-500 mt-1">Thư mục có {activeSubGroup.techniques?.length || 0} bài • {activeSubGroup.techniques?.filter(t => t.isExtracted).length || 0} bài đã có nội dung</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-8">
              <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 md:gap-0 mb-6">
                <h3 className="font-bold text-slate-700 text-base md:text-lg">{isAdmin ? "Bảng điều khiển quản trị" : "Danh sách tài liệu"}</h3>
                <div className="flex flex-wrap gap-2 md:gap-3">
                  {isAdmin && <button onClick={handleDeleteAllTechsInFolder} disabled={!activeSubGroup.techniques || activeSubGroup.techniques.length === 0} className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-red-50 hover:bg-red-600 text-red-600 hover:text-white px-3 md:px-4 py-2 rounded-xl font-bold transition-all disabled:opacity-50 text-xs md:text-sm shadow-sm border border-red-100"><Trash2 size={16} /> Làm sạch</button>}
                  <button onClick={exportGroupToWord} disabled={!activeSubGroup.techniques || activeSubGroup.techniques.length === 0} className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 md:px-4 py-2 rounded-xl font-bold shadow-md transition-all active:scale-95 disabled:opacity-50 text-xs md:text-sm"><FileDown size={16} /> Tải file Word Nhóm</button>
                </div>
              </div>

              {isAdmin && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-8">
                  <div {...excelDrop.getRootProps()} className="bg-white border-2 border-dashed border-green-200 p-4 md:p-6 rounded-2xl hover:border-green-400 hover:bg-green-50 cursor-pointer transition-all flex items-center gap-4 shadow-sm">
                    <input {...excelDrop.getInputProps()} />
                    <div className="p-2 md:p-3 bg-green-100 text-green-600 rounded-xl shrink-0"><Stethoscope size={24} /></div>
                    <div><h3 className="font-bold text-slate-800 text-sm md:text-base">1. Nạp danh sách (Excel)</h3><p className="text-[10px] md:text-xs text-slate-500 mt-1">Lọc trùng lặp tự động</p></div>
                  </div>

                  <div {...wordDrop.getRootProps()} className="bg-white border-2 border-dashed border-blue-200 p-4 md:p-6 rounded-2xl hover:border-blue-400 hover:bg-blue-50 cursor-pointer transition-all flex items-center gap-4 shadow-sm">
                    <input {...wordDrop.getInputProps()} />
                    {isProcessing ? <div className="p-2 md:p-3 bg-blue-100 text-blue-600 rounded-xl shrink-0"><Loader2 size={24} className="animate-spin" /></div> : <div className="p-2 md:p-3 bg-blue-100 text-blue-600 rounded-xl shrink-0"><FileText size={24} /></div>}
                    <div><h3 className="font-bold text-slate-800 text-sm md:text-base">2. Nạp Nội dung (Word)</h3><p className="text-[10px] md:text-xs text-slate-500 mt-1">Quét tự động bóc tách</p></div>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-xl md:rounded-2xl border border-slate-200 shadow-sm overflow-x-auto w-full">
                {!currentFolderTechniques || currentFolderTechniques.length === 0 ? ( <div className="p-8 md:p-12 text-center text-slate-400"><Database size={40} className="mx-auto mb-4 opacity-20" /><p className="text-sm md:text-base">{isAdmin ? "Thư mục trống. Hãy kéo thả file Excel vào đây!" : "Thư mục này hiện chưa có tài liệu nào."}</p></div> ) : (
                  <table className="w-full text-left border-collapse min-w-[500px]"><thead className="bg-slate-50 border-b border-slate-200 text-[10px] md:text-xs uppercase text-slate-500 font-bold tracking-wider"><tr><th className="px-4 md:px-6 py-3 md:py-4">Tên Kỹ thuật</th><th className="px-4 md:px-6 py-3 md:py-4 w-24 md:w-32 text-center">Trạng thái</th><th className="px-4 md:px-6 py-3 md:py-4 w-32 md:w-64 text-right">Thao tác</th></tr></thead><tbody>{currentFolderTechniques.map((tech) => renderTechRow(tech, activeGroup, false))}</tbody></table>
                )}
              </div>
            </div>
          </>
        ) : ( <div className="flex-1 flex items-center justify-center text-slate-400 pt-20"><div className="text-center"><FolderOpen size={48} className="mx-auto mb-4 opacity-20" /><p className="text-sm md:text-lg">Vui lòng chọn một Thư mục ở menu</p></div></div> )}
      </div>

      {/* MODAL TRÌNH SOẠN THẢO */}
      <AnimatePresence>
        {editingTech && (
          <motion.div initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{scale: 0.95, opacity: 0, y: 20}} animate={{scale: 1, opacity: 1, y: 0}} exit={{scale: 0.95, opacity: 0, y: 20}} className="bg-white rounded-2xl md:rounded-3xl shadow-2xl w-full max-w-5xl h-[90vh] md:h-[90vh] flex flex-col overflow-hidden">
              <div className="px-4 md:px-8 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
                <h3 className="text-base md:text-xl font-bold text-slate-800 flex items-center gap-2 md:gap-3 truncate pr-4"><FileText className="text-blue-600 shrink-0" size={20}/> <span className="truncate">{isAdmin ? "Soạn thảo: " : "Chi tiết: "} {stripPrefixNumber(editingTech.name)}</span></h3>
                <div className="flex items-center gap-2 shrink-0">
                  {isAdmin && <button onClick={() => { handleSaveEdit(); }} className="flex items-center gap-1 md:gap-2 bg-green-600 text-white px-3 md:px-5 py-2 rounded-xl font-bold hover:bg-green-700 transition-colors text-xs md:text-sm shadow-sm"><Save size={16} /> <span className="hidden md:inline">Lưu dữ liệu</span></button>}
                  <button onClick={() => setEditingTech(null)} className="p-2 md:p-2.5 bg-white text-slate-400 hover:bg-red-50 hover:text-red-600 rounded-xl border border-slate-200 shadow-sm"><X size={18} /></button>
                </div>
              </div>
              <div className="flex-1 p-4 md:p-8 bg-slate-100 overflow-y-auto">
                <div className="max-w-3xl mx-auto bg-white p-6 md:p-12 rounded-xl shadow-sm border border-slate-200 min-h-full">
                  <div className="prose prose-sm md:prose-slate max-w-none focus:outline-none" contentEditable={isAdmin} dangerouslySetInnerHTML={{ __html: editContent }} onBlur={(e) => isAdmin && setEditContent(e.currentTarget.innerHTML)} style={{fontFamily: "'Times New Roman', serif", fontSize: '14pt', lineHeight: 1.5, textAlign: 'justify'}} />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL CÀI ĐẶT NHÓM LỚN (CHỈ DÀNH CHO ADMIN) */}
      <AnimatePresence>
        {editingGroupMeta && isAdmin && (
          <motion.div initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{scale: 0.95, opacity: 0, y: 20}} animate={{scale: 1, opacity: 1, y: 0}} exit={{scale: 0.95, opacity: 0, y: 20}} className="bg-white rounded-2xl md:rounded-3xl shadow-xl w-full max-w-md p-6 overflow-hidden">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Settings className="text-blue-600" size={20}/> Thông tin Nhóm</h3>
                <button onClick={() => setEditingGroupMeta(null)} className="text-slate-400 hover:text-red-500"><X size={20}/></button>
              </div>
              <div className="space-y-4">
                <div><label className="block text-sm font-bold text-slate-700 mb-1">Tên Nhóm Lớn</label><input type="text" value={editingGroupMeta.name} onChange={e => setEditingGroupMeta({...editingGroupMeta, name: e.target.value})} className="w-full border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-blue-500/50 outline-none" disabled /></div>
                <div><label className="block text-sm font-bold text-slate-700 mb-1">Số Quyết định</label><input type="text" placeholder="VD: 25/QĐ-BYT" value={editingGroupMeta.decisionNum || ''} onChange={e => setEditingGroupMeta({...editingGroupMeta, decisionNum: e.target.value})} className="w-full border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-blue-500/50 outline-none" /></div>
                <div><label className="block text-sm font-bold text-slate-700 mb-1">Ngày ban hành</label><input type="text" placeholder="VD: 03/01/2014" value={editingGroupMeta.issueDate || ''} onChange={e => setEditingGroupMeta({...editingGroupMeta, issueDate: e.target.value})} className="w-full border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-blue-500/50 outline-none" /></div>
                <div><label className="block text-sm font-bold text-slate-700 mb-1">Ngày hiệu lực</label><input type="text" placeholder="VD: 15/01/2014" value={editingGroupMeta.effectiveDate || ''} onChange={e => setEditingGroupMeta({...editingGroupMeta, effectiveDate: e.target.value})} className="w-full border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-blue-500/50 outline-none" /></div>
              </div>
              <div className="mt-8 flex justify-end gap-3">
                <button onClick={() => setEditingGroupMeta(null)} className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-xl text-sm">Hủy</button>
                <button onClick={saveGroupMeta} className="px-6 py-2 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl text-sm shadow-md">Lưu lại</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}