import {
    Component,
    onWillStart,
    onWillUnmount,
    useState,
} from "@odoo/owl";

import { rpc } from "@web/core/network/rpc";

import { registry } from "@web/core/registry";


export class PortalCRM extends Component {

    static template = "crm_portal.PortalCRM";


    setup() {

        const urlParams =
            new URLSearchParams(window.location.search);
        const initialFilter =
            urlParams.get("filter");
        const defaultFilter = (initialFilter === "all" || !initialFilter) ? "opportunity" : initialFilter;

        this.state = useState({

            loading: true,

            error: "",

            leads: [],

            stages: [],

            canEdit: false,

            isAdmin: false,

            salespersons: [],

            currentUserId: false,

            currentPartnerId: false,

            currentUserName: "",

            currencySymbol: "$",

            view: (defaultFilter === "leads" || defaultFilter === "lost_leads") ? "list" : (urlParams.get("view") || "kanban"),

            search: "",

            filter: defaultFilter,

            stageFilter: "all",

            showFilters: (defaultFilter === "leads" || defaultFilter === "lost_leads"),

            showSearchDropdown: false,

            showCreationDateSubmenu: false,

            showSalespersonSubmenu: false,

            creationDateFilter: null,

            selectedSalespersonId: null,

            customStartDate: "",

            customEndDate: "",

            currentMonth: new Date(
                new Date().getFullYear(),
                new Date().getMonth(),
                1
            ),

            draggingLeadId: null,
        });


        // Bind handlers explicitly.
        this.setView =
            this.setView.bind(this);

        this.switchToKanban =
            this.switchToKanban.bind(this);

        this.switchToList =
            this.switchToList.bind(this);

        this.switchToCalendar =
            this.switchToCalendar.bind(this);

        this.handleEmptyCreate =
            this.handleEmptyCreate.bind(this);

        this.toggleFilters =
            this.toggleFilters.bind(this);

        this.setFilter =
            this.setFilter.bind(this);

        this.clearFilters =
            this.clearFilters.bind(this);

        this.onStageFilterChange =
            this.onStageFilterChange.bind(this);

        this.previousMonth =
            this.previousMonth.bind(this);

        this.nextMonth =
            this.nextMonth.bind(this);

        this.goToday =
            this.goToday.bind(this);

        this.newOpportunity =
            this.newOpportunity.bind(this);

        this.newLead =
            this.newLead.bind(this);

        this.toggleLeads =
            this.toggleLeads.bind(this);

        this.openLead =
            this.openLead.bind(this);

        this.startDrag =
            this.startDrag.bind(this);

        this.allowDrop =
            this.allowDrop.bind(this);

        this.dropLead =
            this.dropLead.bind(this);

        this.clearDrag =
            this.clearDrag.bind(this);

        this.restoreLead =
            this.restoreLead.bind(this);

        this.refresh =
            this.refresh.bind(this);

        this.loadCRM =
            this.loadCRM.bind(this);

        this.toggleSearchDropdown =
            this.toggleSearchDropdown.bind(this);

        this.toggleLostLeadFilter =
            this.toggleLostLeadFilter.bind(this);

        this.removeLostLeadFilter =
            this.removeLostLeadFilter.bind(this);

        this.toggleCreationDateSubmenu =
            this.toggleCreationDateSubmenu.bind(this);

        this.toggleSalespersonSubmenu =
            this.toggleSalespersonSubmenu.bind(this);

        this.setCreationDateFilter =
            this.setCreationDateFilter.bind(this);

        this.removeCreationDateFilter =
            this.removeCreationDateFilter.bind(this);

        this.applyCustomDateRange =
            this.applyCustomDateRange.bind(this);

        this.setSalespersonFilter =
            this.setSalespersonFilter.bind(this);

        this.removeSalespersonFilter =
            this.removeSalespersonFilter.bind(this);

        this.onDocumentClick = (event) => {
            if (this.state.showSearchDropdown) {
                const wrapper = document.querySelector(".crm-search-dropdown-wrapper");
                if (wrapper && !wrapper.contains(event.target)) {
                    this.state.showSearchDropdown = false;
                }
            }
        };
        document.addEventListener("click", this.onDocumentClick);

        onWillUnmount(() => {
            document.removeEventListener("click", this.onDocumentClick);
        });


        onWillStart(
            () => this.loadCRM()
        );
    }


    // ============================================================
    // LOAD DATA
    // ============================================================

    async loadCRM() {

        this.state.loading = true;

        this.state.error = "";

        try {

            const data = await rpc(
                "/my/crm/data",
                {}
            );

            const stages = (data.stages || []).map((s) => ({
                ...s,
                name: (s.name || "").trim().toLowerCase() === "proposition" ? "Proposal" : s.name,
            }));

            this.state.stages =
                this.sortStages(stages);

            this.state.leads =
                (data.leads || []).map((lead) => {
                    if (lead.stage_id && (lead.stage_id[1] || "").trim().toLowerCase() === "proposition") {
                        lead.stage_id[1] = "Proposal";
                    }
                    return lead;
                });

            this.state.canEdit =
                Boolean(data.can_edit);

            this.state.isAdmin =
                Boolean(data.is_admin);

            this.state.salespersons =
                data.salespersons || [];

            this.state.currentUserId =
                data.current_user_id || false;

            this.state.currentPartnerId =
                data.current_partner_id || false;

            this.state.currentUserName =
                data.current_user_name || "";

            this.state.currencySymbol =
                data.currency_symbol || "$";

        } catch (error) {

            console.error(
                "CRM Portal load error:",
                error
            );

            this.state.error =
                "Unable to load CRM opportunities.";

        } finally {

            this.state.loading = false;
        }
    }


    async refresh() {

        await this.loadCRM();
    }
    // ============================================================
    // FILTERED LEADS
    // ============================================================


    get searchFilteredLeads() {
        let leads = [...this.state.leads];

        const search = (this.state.search || "")
            .trim()
            .toLowerCase();

        if (search) {
            leads = leads.filter((lead) => {
                const text = [
                    lead.name,
                    lead.partner_name,
                    lead.contact_name,
                    lead.email_from,
                    lead.phone,
                ].join(" ").toLowerCase();

                return text.includes(search);
            });
        }

        // Salesperson Filter (Admin only)
        if (this.state.isAdmin && this.state.selectedSalespersonId) {
            if (this.state.selectedSalespersonId === "unassigned") {
                leads = leads.filter((lead) => !lead.user_id);
            } else {
                const targetSpId = Number(this.state.selectedSalespersonId);
                leads = leads.filter((lead) => {
                    return lead.user_id && Number(lead.user_id[0]) === targetSpId;
                });
            }
        }

        // Creation Date Filter (Admin & Salesperson)
        if (this.state.creationDateFilter) {
            leads = leads.filter((lead) => {
                return this.matchesCreationDate(lead, this.state.creationDateFilter);
            });
        }

        return leads;
    }


    get filteredLeads() {
        let leads = this.searchFilteredLeads;

        // 1. Apply the main status filter first.
        if (this.state.filter === "opportunity" || this.state.filter === "all") {
            // In opportunity filter only see active opportunities
            leads = leads.filter(
                (lead) =>
                    lead.type === "opportunity" &&
                    lead.active !== false &&
                    !this.isLost(lead)
            );
        } else if (this.state.filter === "lost") {
            // In lost filter only see lost opportunities
            leads = leads.filter(
                (lead) =>
                    lead.type === "opportunity" &&
                    (lead.active === false || this.isLost(lead))
            );
        } else if (this.state.filter === "leads") {
            // In leads only see active leads
            leads = leads.filter(
                (lead) =>
                    lead.type === "lead" &&
                    lead.active !== false &&
                    !this.isLost(lead)
            );
        } else if (this.state.filter === "lost_leads") {
            leads = leads.filter(
                (lead) =>
                    lead.type === "lead" &&
                    (lead.active === false || this.isLost(lead))
            );
        } else if (this.state.filter === "open") {
            leads = leads.filter(
                (lead) =>
                    lead.type === "opportunity" &&
                    lead.active !== false &&
                    !this.isWon(lead) &&
                    !this.isLost(lead)
            );
        } else if (this.state.filter === "won") {
            leads = leads.filter(
                (lead) =>
                    lead.type === "opportunity" &&
                    lead.active !== false &&
                    this.isWon(lead) &&
                    !this.isLost(lead)
            );
        }

        // 2. Apply stage filter without overriding the main filter.
        if (
            this.state.filter !== "leads" &&
            this.state.filter !== "lost_leads" &&
            this.state.filter !== "lost" &&
            this.state.stageFilter !== "all"
        ) {
            const stageId = Number(this.state.stageFilter);

            leads = leads.filter(
                (lead) =>
                    lead.stage_id &&
                    Number(lead.stage_id[0]) === stageId
            );
        }

        return leads;
    }


    get kanbanColumns() {
        const normalStages = this.state.stages.filter((stage) => {
            const name = (stage.name || "").trim().toLowerCase();
            return name !== "lost";
        });

        const lostColumn = {
            id: "lost",
            name: "Lost",
            sequence: 999999,
            isLostColumn: true,
        };

        // Find the Won column.
        const wonIndex = normalStages.findIndex(
            (stage) => this.isWonStage(stage)
        );

        // Insert Lost immediately after Won so the Kanban board shows the full pipeline.
        if (wonIndex !== -1) {
            normalStages.splice(wonIndex + 1, 0, lostColumn);
        } else {
            normalStages.push(lostColumn);
        }

        return normalStages;
    }


    sortStages(stages) {
    return [...stages].sort((a, b) => {
        const aName = (a.name || "").toLowerCase();
        const bName = (b.name || "").toLowerCase();

        if (aName === "lost") return 1;
        if (bName === "lost") return -1;

        return (a.sequence || 0) - (b.sequence || 0);
    });
}


    getStageLeads(stageId) {
        // Special column for Lost opportunities in the kanban pipeline.
        if (stageId === "lost") {
            if (this.state.filter === "open" || this.state.filter === "won") {
                return [];
            }
            return this.searchFilteredLeads.filter(
                (lead) =>
                    (lead.type === "opportunity" || !lead.type) &&
                    this.isLost(lead)
            );
        }

        // When specifically filtering for lost, normal stages show 0 cards.
        if (this.state.filter === "lost") {
            return [];
        }

        // Normal stages show active opportunities only.
        let stageLeads = this.searchFilteredLeads.filter(
            (lead) =>
                (lead.type === "opportunity" || !lead.type) &&
                lead.active !== false &&
                !this.isLost(lead) &&
                lead.stage_id &&
                Number(lead.stage_id[0]) === Number(stageId)
        );

        if (this.state.stageFilter !== "all") {
            const stageFilterId = Number(this.state.stageFilter);
            stageLeads = stageLeads.filter(
                (lead) => Number(lead.stage_id[0]) === stageFilterId
            );
        }

        if (this.state.filter === "open") {
            stageLeads = stageLeads.filter((lead) => !this.isWon(lead));
        } else if (this.state.filter === "won") {
            stageLeads = stageLeads.filter((lead) => this.isWon(lead));
        }

        return stageLeads;
    }




    // ============================================================
    // VIEW
    // ============================================================

    setView(view) {

        this.state.view = view;
    }

    switchToKanban() {

        if (this.state.filter === "leads" || this.state.filter === "lost_leads") {
            this.state.filter = "opportunity";
        }
        this.setView("kanban");
    }

    switchToList() {

        this.setView("list");
    }

    switchToCalendar() {

        if (this.state.filter === "leads" || this.state.filter === "lost_leads") {
            this.state.filter = "opportunity";
        }
        this.setView("calendar");
    }


    toggleFilters() {

        this.state.showFilters =
            !this.state.showFilters;
    }


    setFilter(filter) {

        this.state.filter = filter;
        if (filter === "leads" || filter === "lost_leads") {
            this.state.view = "list";
        } else {
            this.state.showSearchDropdown = false;
        }
    }

    toggleSearchDropdown(event) {
        if (event) {
            event.stopPropagation();
        }
        this.state.showSearchDropdown = !this.state.showSearchDropdown;
    }

    toggleLostLeadFilter(event) {
        if (event) {
            event.stopPropagation();
        }
        if (this.state.filter === "lost_leads") {
            this.state.filter = "leads";
        } else {
            this.state.filter = "lost_leads";
            this.state.view = "list";
        }
        this.state.showSearchDropdown = false;
    }

    removeLostLeadFilter(event) {
        if (event) {
            event.stopPropagation();
        }
        this.state.filter = "leads";
    }

    clearFilters() {

        this.state.search = "";

        this.state.filter = "opportunity";

        this.state.stageFilter = "all";

        this.state.showFilters = false;

        this.state.showSearchDropdown = false;

        this.state.showCreationDateSubmenu = false;

        this.state.showSalespersonSubmenu = false;

        this.state.creationDateFilter = null;

        this.state.selectedSalespersonId = null;

        this.state.customStartDate = "";

        this.state.customEndDate = "";
    }


    onStageFilterChange(event) {

        this.state.stageFilter =
            event.target.value;
    }


    // ============================================================
    // CREATION DATE & SALESPERSON FILTERS
    // ============================================================

    matchesCreationDate(lead, filter) {
        if (!lead || !lead.create_date) {
            return false;
        }
        const dateStr = String(lead.create_date).replace(" ", "T");
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) {
            return false;
        }

        if (filter.type === "month") {
            return d.getFullYear() === filter.year && d.getMonth() === filter.month;
        }
        if (filter.type === "quarter") {
            const q = Math.floor(d.getMonth() / 3) + 1;
            return d.getFullYear() === filter.year && q === filter.quarter;
        }
        if (filter.type === "year") {
            return d.getFullYear() === filter.year;
        }
        if (filter.type === "custom") {
            if (filter.startDate) {
                const start = new Date(`${filter.startDate}T00:00:00`);
                if (d < start) {
                    return false;
                }
            }
            if (filter.endDate) {
                const end = new Date(`${filter.endDate}T23:59:59.999`);
                if (d > end) {
                    return false;
                }
            }
            return true;
        }
        return true;
    }

    get creationDateMonths() {
        const now = new Date();
        const currentYear = now.getFullYear();
        const monthNames = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];
        const currentMonth = now.getMonth();
        const months = [];
        for (let offset = 0; offset < 3; offset++) {
            let mIndex = currentMonth - offset;
            let year = currentYear;
            if (mIndex < 0) {
                mIndex += 12;
                year -= 1;
            }
            months.push({
                key: `month_${year}_${mIndex}`,
                type: "month",
                month: mIndex,
                year: year,
                label: monthNames[mIndex],
            });
        }
        return months;
    }

    get creationDateQuarters() {
        const currentYear = new Date().getFullYear();
        return [
            { key: `q_${currentYear}_4`, type: "quarter", quarter: 4, year: currentYear, label: "Q4" },
            { key: `q_${currentYear}_3`, type: "quarter", quarter: 3, year: currentYear, label: "Q3" },
            { key: `q_${currentYear}_2`, type: "quarter", quarter: 2, year: currentYear, label: "Q2" },
            { key: `q_${currentYear}_1`, type: "quarter", quarter: 1, year: currentYear, label: "Q1" },
        ];
    }

    get creationDateYears() {
        const currentYear = new Date().getFullYear();
        return [
            { key: `year_${currentYear}`, type: "year", year: currentYear, label: String(currentYear) },
            { key: `year_${currentYear - 1}`, type: "year", year: currentYear - 1, label: String(currentYear - 1) },
            { key: `year_${currentYear - 2}`, type: "year", year: currentYear - 2, label: String(currentYear - 2) },
        ];
    }

    isDateFilterActive(item) {
        if (!this.state.creationDateFilter) {
            return false;
        }
        return this.state.creationDateFilter.key === item.key;
    }

    toggleCreationDateSubmenu(event) {
        if (event) {
            event.stopPropagation();
        }
        this.state.showCreationDateSubmenu = !this.state.showCreationDateSubmenu;
    }

    toggleSalespersonSubmenu(event) {
        if (event) {
            event.stopPropagation();
        }
        this.state.showSalespersonSubmenu = !this.state.showSalespersonSubmenu;
    }

    setCreationDateFilter(item) {
        if (this.state.creationDateFilter && this.state.creationDateFilter.key === item.key) {
            this.state.creationDateFilter = null;
        } else {
            this.state.creationDateFilter = item;
        }
        this.state.showSearchDropdown = false;
    }

    removeCreationDateFilter(event) {
        if (event) {
            event.stopPropagation();
        }
        this.state.creationDateFilter = null;
        this.state.customStartDate = "";
        this.state.customEndDate = "";
    }

    applyCustomDateRange(event) {
        if (event) {
            event.stopPropagation();
        }
        const start = this.state.customStartDate;
        const end = this.state.customEndDate;
        if (!start && !end) {
            return;
        }

        let label = "";
        if (start && end) {
            label = `${start} to ${end}`;
        } else if (start) {
            label = `From ${start}`;
        } else {
            label = `Until ${end}`;
        }

        this.state.creationDateFilter = {
            key: `custom_${start}_${end}`,
            type: "custom",
            startDate: start,
            endDate: end,
            label: label,
        };
        this.state.showSearchDropdown = false;
    }

    get availableSalespersons() {
        const spMap = new Map();
        (this.state.salespersons || []).forEach((sp) => {
            if (sp && sp.id) {
                spMap.set(String(sp.id), sp);
            }
        });
        (this.state.leads || []).forEach((l) => {
            if (l.user_id && l.user_id[0]) {
                const id = String(l.user_id[0]);
                if (!spMap.has(id)) {
                    spMap.set(id, { id: l.user_id[0], name: l.user_id[1] });
                }
            }
        });
        return Array.from(spMap.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    get selectedSalespersonName() {
        if (!this.state.selectedSalespersonId) {
            return "";
        }
        if (this.state.selectedSalespersonId === "unassigned") {
            return "Unassigned";
        }
        const sp = this.availableSalespersons.find((s) => String(s.id) === String(this.state.selectedSalespersonId));
        return sp ? sp.name : "Salesperson";
    }

    setSalespersonFilter(spId) {
        if (this.state.selectedSalespersonId === spId) {
            this.state.selectedSalespersonId = null;
        } else {
            this.state.selectedSalespersonId = spId;
        }
        this.state.showSearchDropdown = false;
    }

    removeSalespersonFilter(event) {
        if (event) {
            event.stopPropagation();
        }
        this.state.selectedSalespersonId = null;
    }


    // ============================================================
    // NAVIGATION
    // ============================================================

    newOpportunity() {

        window.location.href =
            "/my/crm/new";
    }


    newLead() {

        window.location.href =
            "/my/crm/new?type=lead";
    }


    handleEmptyCreate() {

        if (this.state.filter === "leads" || this.state.filter === "lost_leads") {
            this.newLead();
        } else {
            this.newOpportunity();
        }
    }


    toggleLeads() {

        if (this.state.filter === "leads" || this.state.filter === "lost_leads") {
            this.state.filter = "opportunity";
            this.state.view = "kanban";
        } else {
            this.state.filter = "leads";
            this.state.view = "list";
        }
    }


    openLead(lead) {

        window.location.href =
            `/my/crm/${lead.id}`;
    }


    async restoreLead(lead, event) {

        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }

        if (!this.state.canEdit) {
            return;
        }

        try {
            const result = await rpc("/my/crm/restore", {
                lead_id: lead.id,
            });

            if (result && result.success) {
                await this.loadCRM();
            } else {
                this.state.error = (result && result.error) || "Unable to restore record.";
            }
        } catch (error) {
            console.error("CRM restore error:", error);
            this.state.error = "Unable to restore record.";
        }
    }


    // ============================================================
    // DRAG AND DROP
    // ============================================================

    canDrag(stage, lead) {
        if (!this.state.canEdit) {
            return false;
        }
        if (stage && (stage.id === "lost" || stage.isLostColumn)) {
            return false;
        }
        if (this.isLost(lead)) {
            return false;
        }
        return true;
    }

    startDrag(lead, event) {

        if (!this.state.canEdit || this.isLost(lead)) {
            return;
        }

        this.state.draggingLeadId =
            lead.id;

        if (event.dataTransfer) {

            event.dataTransfer.effectAllowed =
                "move";

            event.dataTransfer.setData(
                "text/plain",
                String(lead.id)
            );
        }
    }


    allowDrop(event, stage) {

        if (!this.state.canEdit) {
            return;
        }

        if (stage && (stage.id === "lost" || stage.isLostColumn)) {
            return;
        }

        event.preventDefault();

        if (event.dataTransfer) {

            event.dataTransfer.dropEffect =
                "move";
        }
    }


    async dropLead(stageId, event) {

        // Remove the lost drag drop option: drop into lost is prohibited
        if (!this.state.canEdit || stageId === "leads" || stageId === "lost") {
            this.clearDrag();
            return;
        }

        event.preventDefault();

        let leadId =
            this.state.draggingLeadId;


        if (
            !leadId
            && event.dataTransfer
        ) {

            leadId =
                parseInt(
                    event.dataTransfer.getData(
                        "text/plain"
                    ),
                    10
                );
        }


        if (!leadId) {

            this.clearDrag();

            return;
        }


        const lead =
            this.state.leads.find(
                (item) =>
                    item.id === leadId
            );


        if (!lead) {

            this.clearDrag();

            return;
        }


        // Won stage validation: won stage opportunity cannot convert into lost
        if (this.isWon(lead) && (stageId === "lost" || stageId === false)) {
            this.clearDrag();
            return;
        }

        const currentStageId =
            lead.stage_id
                ? lead.stage_id[0]
                : false;
        const currentIsLost = this.isLost(lead);

        if (stageId === "lost") {
            this.clearDrag();
            return;
        } else if (currentStageId === stageId && !currentIsLost) {
            this.clearDrag();
            return;
        }


        try {

            const result =
                await rpc(
                    "/my/crm/move-stage",
                    {
                        lead_id: leadId,
                        stage_id: stageId,
                    }
                );


            if (!result.success) {

                this.state.error =
                    result.error
                    || "Unable to move opportunity.";

                return;
            }

            if (stageId === "lost") {
                lead.active = false;
                lead.is_lost = true;
            } else {
                lead.active = true;
                lead.is_lost = false;
                if (result.stage) {
                    lead.stage_id = result.stage;
                } else {
                    const stage =
                        this.state.stages.find(
                            (item) =>
                                item.id === stageId
                        );

                    if (stage) {
                        lead.stage_id = [
                            stage.id,
                            stage.name,
                        ];
                    }
                }
                if (result.partner_id) {
                    lead.partner_id = result.partner_id;
                }
                if (result.partner_name) {
                    lead.partner_name = result.partner_name;
                }
                if (result.contact_name) {
                    lead.contact_name = result.contact_name;
                }
                if (result.email_from) {
                    lead.email_from = result.email_from;
                }
                if (result.phone) {
                    lead.phone = result.phone;
                }
            }

        } catch (error) {

            console.error(
                "CRM stage move error:",
                error
            );

            this.state.error =
                "Unable to move opportunity.";

        } finally {

            this.clearDrag();
        }
    }


    clearDrag() {

        this.state.draggingLeadId =
            null;
    }




    // ============================================================
    // HELPERS
    // ============================================================

    formatCurrency(value) {

        const amount =
            Number.parseFloat(
                value || 0
            );


        const safeAmount =
            Number.isFinite(amount)
                ? amount
                : 0;


        return (
            this.state.currencySymbol
            + " "
            + safeAmount.toLocaleString(
                "en-US",
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                }
            )
        );
    }


    stageRevenue(stageId) {

        return this.getStageLeads(stageId)
            .reduce(
                (total, lead) => {

                    const value =
                        Number.parseFloat(
                            lead.expected_revenue || 0
                        );

                    return total
                        + (
                            Number.isFinite(value)
                                ? value
                                : 0
                        );
                },
                0
            );
    }
    isWon(lead) {

        const name =
            lead.stage_id
                ? lead.stage_id[1]
                : "";

        return (
            name || ""
        )
        .toLowerCase()
        .includes("won");
    }
    isLost(lead) {
        if (!lead) {
            return false;
        }
        // Active opportunities and leads are never lost
        if (lead.active !== false) {
            return false;
        }
        // Inactive records: lost if opportunity or explicitly marked is_lost
        if (lead.type === "opportunity" || lead.type === "lead" || !lead.type) {
            return true;
        }
        return Boolean(lead.is_lost);
    }

    priorityStars() {

        return [
            1,
            2,
            3,
        ];
    }
    isPriorityActive(
        lead,
        star
    ) {

        const priority =
            parseInt(
                lead.priority || "0",
                10
            );
        return (
            priority >= star
        );
    }
    formatDate(value) {

        if (!value) {
            return "";
        }

        const date =
            new Date(
                `${value}T00:00:00`
            );

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return value;
        }

        return date.toLocaleDateString(
            "en-US"
        );
    }
    dateKey(date) {

        const year =
            date.getFullYear();

        const month =
            String(
                date.getMonth() + 1
            ).padStart(2, "0");

        const day =
            String(
                date.getDate()
            ).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }
    getLeadsForDate(dateKey) {

        return this.filteredLeads.filter(
            (lead) =>
                lead.date_deadline
                === dateKey
        );
    }


    // ============================================================
    // CALENDAR
    // ============================================================

    get calendarWeeks() {

        const year =
            this.state.currentMonth
                .getFullYear();

        const month =
            this.state.currentMonth
                .getMonth();


        const first =
            new Date(
                year,
                month,
                1
            );


        const day =
            first.getDay();


        const mondayOffset =
            day === 0
                ? 6
                : day - 1;


        const start =
            new Date(first);

        start.setDate(
            first.getDate()
            - mondayOffset
        );


        const weeks = [];


        for (
            let week = 0;
            week < 6;
            week++
        ) {

            const days = [];


            for (
                let dayIndex = 0;
                dayIndex < 7;
                dayIndex++
            ) {

                const date =
                    new Date(start);


                date.setDate(
                    start.getDate()
                    + (
                        week * 7
                    )
                    + dayIndex
                );


                const key =
                    this.dateKey(date);


                days.push({
                    date,
                    key,
                    leads:
                        this.getLeadsForDate(
                            key
                        ),
                    currentMonth:
                        date.getMonth()
                        === month,
                });
            }


            weeks.push(days);
        }


        return weeks;
    }


    previousMonth() {

        this.state.currentMonth =
            new Date(
                this.state.currentMonth
                    .getFullYear(),
                this.state.currentMonth
                    .getMonth() - 1,
                1
            );
    }
    nextMonth() {

        this.state.currentMonth =
            new Date(
                this.state.currentMonth
                    .getFullYear(),
                this.state.currentMonth
                    .getMonth() + 1,
                1
            );
    }
    goToday() {

        const now =
            new Date();

        this.state.currentMonth =
            new Date(
                now.getFullYear(),
                now.getMonth(),
                1
            );
    }
    get monthTitle() {

        return this.state.currentMonth.toLocaleDateString(
            "en-US",
            {
                month: "long",
                year: "numeric",
            }
        );
    }


    // ============================================================
    // RELATIVE DATE
    // ============================================================

    relativeDate(value) {

        if (!value) {
            return "";
        }

        const date =
            new Date(`${value}T00:00:00`);

        if (Number.isNaN(date.getTime())) {
            return value;
        }

        const now = new Date();

        const diffMs =
            now.getTime() - date.getTime();

        const diffDays =
            Math.round(
                diffMs / (1000 * 60 * 60 * 24)
            );

        if (diffDays === 0) {
            return "Today";
        }

        if (diffDays === 1) {
            return "Yesterday";
        }

        if (diffDays === -1) {
            return "Tomorrow";
        }

        if (diffDays > 0) {
            return `${diffDays} days ago`;
        }

        return `In ${Math.abs(diffDays)} days`;
    }


    // ============================================================
    // WON STAGE DETECTION
    // ============================================================

    isWonStage(stage) {

        const name =
            (stage.name || "").toLowerCase();

        return (
            name.includes("won")
            || name.includes("closed")
        );
    }
}

registry
    .category("public_components")
    .add(
        "crm_portal.PortalCRM",
        PortalCRM
    );

// ============================================================
// PORTAL CUSTOMER & COMPANY AUTOFILL / WON ASSIGNMENT
// ============================================================

function initPortalCRMDetail() {
    var customerSelect = document.getElementById("crm_partner_id_select") || document.getElementById("crm_lead_partner_id_select") || document.querySelector('.crm-customer-select') || document.querySelector('select[name="partner_id"]');
    var companySelect = document.getElementById("crm_company_partner_id");
    var hiddenPartnerName = document.getElementById("crm_partner_name_hidden");
    var stageSelect = document.getElementById("crm_stage_id_select");
    var stageBarItems = document.querySelectorAll(".crm-stage-bar .crm-stage-item");
    var contactNameInput = document.getElementById("crm_opp_contact_name") || document.getElementById("crm_contact_name") || document.querySelector('input[name="contact_name"]');
    var contactNameList = document.getElementById("crm_contact_name_list");
    var emailInput = document.getElementById("crm_email_from") || document.getElementById("crm_opp_email_from") || document.querySelector('input[name="email_from"]');
    var phoneInput = document.getElementById("crm_phone") || document.getElementById("crm_opp_phone") || document.querySelector('input[name="phone"]');
    var websiteInput = document.getElementById("crm_website") || document.querySelector('input[name="website"]');
    var funcInput = document.getElementById("crm_partner_function") || document.querySelector('input[name="function"]') || document.querySelector('input[name="partner_function"]');
    var streetInput = document.getElementById("crm_partner_street") || document.querySelector('input[name="street"]') || document.querySelector('input[name="partner_street"]');
    var street2Input = document.getElementById("crm_partner_street2") || document.querySelector('input[name="street2"]') || document.querySelector('input[name="partner_street2"]');
    var cityInput = document.getElementById("crm_partner_city") || document.querySelector('input[name="city"]') || document.querySelector('input[name="partner_city"]');
    var zipInput = document.getElementById("crm_partner_zip") || document.querySelector('input[name="zip"]') || document.querySelector('input[name="partner_zip"]');
    var stateSelect = document.getElementById("crm_partner_state_id") || document.querySelector('select[name="state_id"]') || document.querySelector('select[name="partner_state_id"]');
    var countrySelect = document.getElementById("crm_partner_country_id") || document.querySelector('select[name="country_id"]') || document.querySelector('select[name="partner_country_id"]');

    var container = document.querySelector(".crm-detail-page") || document.querySelector("form.crm-detail-card") || document.getElementById("crm_detail_form");
    if (!container) {
        return;
    }
    var companies = [];
    var customers = [];
    if (container) {
        try {
            companies = JSON.parse(container.getAttribute("data-companies") || "[]");
        } catch (e) {
            companies = [];
        }
        try {
            customers = JSON.parse(container.getAttribute("data-customers") || "[]");
        } catch (e) {
            customers = [];
        }
    }

    function isWonStage() {
        var activeStage = document.querySelector(".crm-stage-item.crm-stage-active");
        if (activeStage) {
            var isWonAttr = activeStage.getAttribute("data-is-won");
            if (isWonAttr === "1") return true;
            var txt = (activeStage.textContent || "").trim().toLowerCase();
            if (txt.includes("won")) return true;
        }
        if (stageSelect && stageSelect.tagName === "SELECT" && stageSelect.options && stageSelect.selectedIndex >= 0) {
            var selectedOpt = stageSelect.options[stageSelect.selectedIndex];
            if (selectedOpt) {
                var txt2 = (selectedOpt.textContent || "").trim().toLowerCase();
                return txt2.includes("won");
            }
        }
        return false;
    }

    function populateCompanyContacts(comp) {
        if (contactNameList) {
            contactNameList.innerHTML = "";
            if (comp && comp.contacts) {
                comp.contacts.forEach(function (c) {
                    var opt = document.createElement("option");
                    opt.value = c.name;
                    opt.textContent = c.name + (c.function ? " (" + c.function + ")" : "");
                    contactNameList.appendChild(opt);
                });
            }
        }
    }

    function fillCompanyAddress(comp) {
        if (!comp) return;
        if (streetInput && comp.street) streetInput.value = comp.street;
        if (street2Input && comp.street2) street2Input.value = comp.street2;
        if (cityInput && comp.city) cityInput.value = comp.city;
        if (zipInput && comp.zip) zipInput.value = comp.zip;
        if (stateSelect && comp.state_id) stateSelect.value = comp.state_id;
        if (countrySelect && comp.country_id) countrySelect.value = comp.country_id;
        if (websiteInput && comp.website) websiteInput.value = comp.website;
    }

    var companyNameInput = document.getElementById("crm_opp_partner_name") || document.getElementById("crm_partner_name") || document.querySelector('input[name="partner_name"]');

    function autoAssignWonCustomer() {
        var compName = "";
        if (companyNameInput && companyNameInput.value) {
            compName = companyNameInput.value.trim();
        } else if (hiddenPartnerName && hiddenPartnerName.value) {
            compName = hiddenPartnerName.value.trim();
        } else if (companySelect && companySelect.value) {
            var selectedCompanyId = String(companySelect.value);
            var comp = companies.find(function (c) {
                return String(c.id) === selectedCompanyId;
            });
            if (comp) compName = comp.name;
        } else {
            var oppTitleInput = document.querySelector('input[name="name"]');
            if (oppTitleInput && oppTitleInput.value) {
                compName = oppTitleInput.value.trim();
            }
        }

        var contactName = contactNameInput && contactNameInput.value ? contactNameInput.value.trim() : "";
        if (!compName && !contactName) {
            var customerHeaderSpan = document.querySelector(".crm-detail-customer span:last-child");
            if (customerHeaderSpan) {
                customerHeaderSpan.textContent = "";
            }
            return;
        }

        // Standard Odoo CRM Dynamic Contact Field Display:
        // 1. When both Company Name and Contact Name are entered -> "Company Name, Contact Name"
        // 2. When only Contact Name is entered -> "Contact Name"
        // 3. When only Company Name is entered -> "Company Name"
        var displayName = "";
        if (compName && contactName) {
            displayName = compName + ", " + contactName;
        } else if (contactName) {
            displayName = contactName;
        } else if (compName) {
            displayName = compName;
        }

        var lowerCompName = compName.toLowerCase();
        var companyPartner = null;
        if (compName) {
            companyPartner = customers.find(function (c) {
                return (c.name || "").trim().toLowerCase() === lowerCompName && c.is_company;
            }) || customers.find(function (c) {
                return (c.name || "").trim().toLowerCase() === lowerCompName;
            });
        }

        var targetContact = null;
        if (contactName) {
            var lowerContactName = contactName.toLowerCase();
            if (companyPartner) {
                targetContact = customers.find(function (c) {
                    return (c.name || "").trim().toLowerCase() === lowerContactName && String(c.parent_id) === String(companyPartner.id);
                });
            }
            if (!targetContact) {
                targetContact = customers.find(function (c) {
                    return !c.is_company && (c.name || "").trim().toLowerCase() === lowerContactName;
                });
            }
        }

        var targetPartner = targetContact || companyPartner;

        var allSelects = document.querySelectorAll(".crm-customer-select");
        allSelects.forEach(function (selectEl) {
            if (targetPartner) {
                var optExists = false;
                for (var i = 0; i < selectEl.options.length; i++) {
                    if (String(selectEl.options[i].value) === String(targetPartner.id)) {
                        selectEl.selectedIndex = i;
                        optExists = true;
                        break;
                    }
                }
                if (!optExists) {
                    var newOpt = document.createElement("option");
                    newOpt.value = targetPartner.id;
                    newOpt.textContent = targetPartner.display_name || displayName;
                    newOpt.selected = true;
                    selectEl.appendChild(newOpt);
                }
            } else if (displayName) {
                var foundDynOpt = null;
                for (var j = 0; j < selectEl.options.length; j++) {
                    if (selectEl.options[j].getAttribute("data-dynamic-contact") === "true") {
                        foundDynOpt = selectEl.options[j];
                        break;
                    }
                }
                if (foundDynOpt) {
                    foundDynOpt.textContent = displayName;
                    foundDynOpt.value = "";
                    foundDynOpt.selected = true;
                } else {
                    var dynOpt = document.createElement("option");
                    dynOpt.value = "";
                    dynOpt.textContent = displayName;
                    dynOpt.setAttribute("data-dynamic-contact", "true");
                    dynOpt.selected = true;
                    selectEl.appendChild(dynOpt);
                }
            } else {
                for (var k = selectEl.options.length - 1; k >= 0; k--) {
                    if (selectEl.options[k].getAttribute("data-dynamic-contact") === "true") {
                        selectEl.remove(k);
                    }
                }
            }
        });

        var customerHeaderSpan = document.querySelector(".crm-detail-customer span:last-child");
        if (customerHeaderSpan && displayName) {
            customerHeaderSpan.textContent = displayName;
        }
        var customerAvatarSpan = document.querySelector(".crm-detail-avatar");
        if (customerAvatarSpan && displayName) {
            customerAvatarSpan.textContent = displayName.charAt(0).toUpperCase();
        }
    }

    if (companySelect) {
        companySelect.addEventListener("change", function () {
            var compId = String(this.value);
            var comp = companies.find(function (c) {
                return String(c.id) === compId;
            });
            if (comp) {
                if (hiddenPartnerName) hiddenPartnerName.value = comp.name;
                fillCompanyAddress(comp);
                populateCompanyContacts(comp);
                if (isWonStage()) {
                    autoAssignWonCustomer();
                }
            } else {
                if (hiddenPartnerName) hiddenPartnerName.value = "";
                if (contactNameList) contactNameList.innerHTML = "";
            }
        });

        if (companySelect.value) {
            var initCompId = String(companySelect.value);
            var initComp = companies.find(function (c) {
                return String(c.id) === initCompId;
            });
            if (initComp) {
                populateCompanyContacts(initComp);
            }
        }
    }

    if (contactNameInput) {
        contactNameInput.addEventListener("input", function () {
            var val = (this.value || "").trim().toLowerCase();
            if (val && companySelect && companySelect.value) {
                var comp = companies.find(function (c) {
                    return String(c.id) === String(companySelect.value);
                });
                if (comp && comp.contacts) {
                    var matched = comp.contacts.find(function (c) {
                        return (c.name || "").trim().toLowerCase() === val;
                    });
                    if (matched) {
                        if (emailInput && matched.email) emailInput.value = matched.email;
                        if (phoneInput && matched.phone) phoneInput.value = matched.phone;
                        if (funcInput && matched.function) funcInput.value = matched.function;
                    }
                }
            }
            autoAssignWonCustomer();
        });
        contactNameInput.addEventListener("change", function () {
            autoAssignWonCustomer();
        });
    }

    if (companyNameInput) {
        companyNameInput.addEventListener("input", function () {
            autoAssignWonCustomer();
        });
        companyNameInput.addEventListener("change", function () {
            autoAssignWonCustomer();
        });
    }

    autoAssignWonCustomer();

    if (stageSelect) {
        stageSelect.addEventListener("change", function () {
            autoAssignWonCustomer();
            var currentStageId = String(this.value);
            stageBarItems.forEach(function (item) {
                if (item.getAttribute("data-stage-id") === currentStageId) {
                    item.classList.add("crm-stage-active");
                } else {
                    item.classList.remove("crm-stage-active");
                }
            });
        });
    }

    stageBarItems.forEach(function (item) {
        item.style.cursor = "pointer";
        item.addEventListener("click", function () {
            var stageId = this.getAttribute("data-stage-id");
            stageBarItems.forEach(function (it) {
                it.classList.remove("crm-stage-active");
            });
            this.classList.add("crm-stage-active");
            if (stageSelect && stageId) {
                stageSelect.value = stageId;
                stageSelect.dispatchEvent(new Event("change"));
            }
            autoAssignWonCustomer();
        });
    });

    var allCustomerSelects = document.querySelectorAll(".crm-customer-select");
    allCustomerSelects.forEach(function (selectEl) {
        selectEl.addEventListener("change", function () {
            fillContactFieldsById(this.value);
        });
    });

    function fillContactFieldsById(selectedId) {
        if (!selectedId) return;
        var cust = customers.find(function (c) {
            return String(c.id) === String(selectedId);
        });
        if (!cust) return;

        if (emailInput && cust.email) emailInput.value = cust.email;
        if (phoneInput && cust.phone) phoneInput.value = cust.phone;
        if (websiteInput && cust.website) websiteInput.value = cust.website;
        if (funcInput && cust.function) funcInput.value = cust.function;
        if (streetInput && cust.street) streetInput.value = cust.street;
        if (street2Input && cust.street2) street2Input.value = cust.street2;
        if (cityInput && cust.city) cityInput.value = cust.city;
        if (zipInput && cust.zip) zipInput.value = cust.zip;
        if (stateSelect && cust.state_id) stateSelect.value = cust.state_id;
        if (countrySelect && cust.country_id) countrySelect.value = cust.country_id;

        if (cust.is_company) {
            if (companySelect) {
                for (var i = 0; i < companySelect.options.length; i++) {
                    if (String(companySelect.options[i].value) === String(cust.id)) {
                        companySelect.selectedIndex = i;
                        break;
                    }
                }
            }
            if (hiddenPartnerName) hiddenPartnerName.value = cust.name;
            if (companyNameInput) companyNameInput.value = cust.name;
            if (contactNameInput) contactNameInput.value = "";
        } else {
            if (contactNameInput) contactNameInput.value = cust.name;
            if (cust.parent_id && companySelect) {
                for (var j = 0; j < companySelect.options.length; j++) {
                    if (String(companySelect.options[j].value) === String(cust.parent_id)) {
                        companySelect.selectedIndex = j;
                        break;
                    }
                }
            }
            if (hiddenPartnerName && cust.parent_name) hiddenPartnerName.value = cust.parent_name;
            if (companyNameInput) companyNameInput.value = cust.parent_name || "";
            if (!cust.parent_id) {
                if (companySelect) companySelect.value = "";
                if (hiddenPartnerName) hiddenPartnerName.value = "";
            }
        }

        var headerName = cust.display_name || cust.name;
        var customerHeaderSpan = document.querySelector(".crm-detail-customer span:last-child");
        if (customerHeaderSpan) {
            customerHeaderSpan.textContent = headerName;
        }
        var customerAvatarSpan = document.querySelector(".crm-detail-avatar");
        if (customerAvatarSpan && headerName) {
            customerAvatarSpan.textContent = headerName.charAt(0).toUpperCase();
        }
    }

    // ============================================================
    // TAG WIDGET (Odoo Many2many Tags Style)
    // ============================================================
    function initTagWidgets() {
        var tagWidgets = document.querySelectorAll(".crm-tag-widget:not(.crm-tag-widget-readonly)");
        tagWidgets.forEach(function (widget) {
            var input = widget.querySelector(".crm-tag-input");
            var chipsWrapper = widget.querySelector(".crm-tag-chips-wrapper");
            var dropdown = widget.querySelector(".crm-tag-dropdown");
            var caret = widget.querySelector(".crm-tag-caret");
            if (!input || !dropdown || !chipsWrapper) return;

            function updatePlaceholder() {
                var pillsCount = chipsWrapper.querySelectorAll(".crm-tag-pill").length;
                if (pillsCount === 0) {
                    input.placeholder = "Search tags...";
                } else {
                    input.placeholder = "";
                }
            }
            updatePlaceholder();

            function filterDropdown(query) {
                var items = dropdown.querySelectorAll(".crm-tag-dropdown-item");
                var visibleCount = 0;
                var q = (query || "").trim().toLowerCase();

                items.forEach(function (item) {
                    var id = item.getAttribute("data-id");
                    var name = (item.getAttribute("data-name") || item.textContent).trim().toLowerCase();
                    var isSelected = !!chipsWrapper.querySelector('.crm-tag-pill[data-id="' + id + '"]');

                    if (isSelected) {
                        item.classList.add("d-none");
                    } else if (!q || name.indexOf(q) !== -1) {
                        item.classList.remove("d-none");
                        visibleCount++;
                    } else {
                        item.classList.add("d-none");
                    }
                });

                var emptyMsg = dropdown.querySelector(".crm-tag-dropdown-empty");
                if (emptyMsg) {
                    if (visibleCount === 0) {
                        emptyMsg.classList.remove("d-none");
                        if (q) {
                            emptyMsg.textContent = 'No tags matching "' + query + '"';
                        } else {
                            emptyMsg.textContent = "All tags selected";
                        }
                    } else {
                        emptyMsg.classList.add("d-none");
                    }
                }
            }

            function openDropdown() {
                document.querySelectorAll(".crm-tag-widget.is-open").forEach(function (w) {
                    if (w !== widget) w.classList.remove("is-open");
                });
                widget.classList.add("is-open");
                filterDropdown(input.value);
            }

            function closeDropdown() {
                widget.classList.remove("is-open");
            }

            function addTag(id, name, color) {
                if (!id || !name) return;
                id = String(id);
                if (chipsWrapper.querySelector('.crm-tag-pill[data-id="' + id + '"]')) return;

                color = color || "0";
                var pill = document.createElement("span");
                pill.className = "crm-tag-pill crm-tag-color-" + color;
                pill.setAttribute("data-id", id);
                pill.setAttribute("data-name", name);
                pill.setAttribute("data-color", color);
                pill.innerHTML = '<span class="crm-tag-text">' + name + '</span>' +
                    '<button type="button" class="crm-tag-remove" data-id="' + id + '" aria-label="Remove">&times;</button>' +
                    '<input type="hidden" name="tag_ids" value="' + id + '"/>';
                chipsWrapper.appendChild(pill);

                input.value = "";
                updatePlaceholder();
                filterDropdown("");
                input.focus();
            }

            function removeTag(id) {
                id = String(id);
                var pill = chipsWrapper.querySelector('.crm-tag-pill[data-id="' + id + '"]');
                if (pill) pill.remove();

                updatePlaceholder();
                filterDropdown(input.value);
                input.focus();
            }

            widget.addEventListener("click", function (e) {
                var removeBtn = e.target.closest(".crm-tag-remove");
                if (removeBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    removeTag(removeBtn.getAttribute("data-id"));
                    return;
                }

                var dropdownItem = e.target.closest(".crm-tag-dropdown-item");
                if (dropdownItem) {
                    e.preventDefault();
                    e.stopPropagation();
                    var tid = dropdownItem.getAttribute("data-id");
                    var tname = dropdownItem.getAttribute("data-name");
                    var tcolor = dropdownItem.getAttribute("data-color");
                    addTag(tid, tname, tcolor);
                    return;
                }

                if (caret && (e.target === caret || caret.contains(e.target))) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (widget.classList.contains("is-open")) {
                        closeDropdown();
                    } else {
                        input.focus();
                        openDropdown();
                    }
                    return;
                }

                input.focus();
                openDropdown();
            });

            input.addEventListener("focus", function () {
                openDropdown();
            });

            input.addEventListener("input", function () {
                if (!widget.classList.contains("is-open")) {
                    widget.classList.add("is-open");
                }
                filterDropdown(this.value);
            });

            input.addEventListener("keydown", function (e) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    var firstVisible = dropdown.querySelector(".crm-tag-dropdown-item:not(.d-none)");
                    if (firstVisible) {
                        var tid = firstVisible.getAttribute("data-id");
                        var tname = firstVisible.getAttribute("data-name");
                        var tcolor = firstVisible.getAttribute("data-color");
                        addTag(tid, tname, tcolor);
                    }
                } else if (e.key === "Backspace" && this.value === "") {
                    var pills = chipsWrapper.querySelectorAll(".crm-tag-pill");
                    if (pills.length > 0) {
                        var lastPill = pills[pills.length - 1];
                        removeTag(lastPill.getAttribute("data-id"));
                    }
                } else if (e.key === "Escape") {
                    closeDropdown();
                }
            });

            document.addEventListener("click", function (e) {
                if (!widget.contains(e.target)) {
                    closeDropdown();
                }
            });
        });
    }

    // ============================================================
    // CONVERT TO OPPORTUNITY MODAL
    // ============================================================
    function initConvertModal() {
        var modal = document.getElementById("crmConvertModal");
        if (!modal) return;

        var convRadios = modal.querySelectorAll('input[name="conversion_action"]');
        var custRadios = modal.querySelectorAll('input[name="customer_action"]');
        var mergeWrapper = document.getElementById("crm_merge_opportunities_wrapper");
        var custWrapper = document.getElementById("crm_customer_action_wrapper");
        var companyBox = document.getElementById("crm_company_link_box");
        var partnerBox = document.getElementById("crm_existing_partner_box");
        var modalCompanyInput = document.getElementById("crm_modal_company_name");
        var modalUserInput = modal.querySelector('select[name="user_id"]');
        var modalTeamInput = modal.querySelector('select[name="team_id"]');
        var modalPartnerSelect = modal.querySelector('select[name="partner_id"]');

        function fetchCompanyFromForm() {
            var formComp = document.getElementById("crm_partner_name")
                || document.getElementById("crm_opp_partner_name")
                || document.querySelector('form#crm_detail_form input[name="partner_name"]')
                || document.querySelector('input[name="partner_name"]');
            var val = formComp ? (formComp.value || "").trim() : "";
            if (!val) {
                var hiddenComp = document.getElementById("crm_partner_name_hidden");
                if (hiddenComp && hiddenComp.value) val = hiddenComp.value.trim();
            }
            if (!val && customerSelect && customerSelect.selectedIndex >= 0) {
                var opt = customerSelect.options[customerSelect.selectedIndex];
                if (opt && opt.value) {
                    var custObj = customers.find(function (c) { return String(c.id) === String(opt.value); });
                    if (custObj) {
                        val = custObj.is_company ? custObj.name : (custObj.parent_name || "");
                    }
                }
            }
            return val;
        }

        function syncFromFormToModal() {
            var compVal = fetchCompanyFromForm();
            if (modalCompanyInput) {
                modalCompanyInput.value = compVal;
            }

            var pageContainer = document.querySelector(".crm-detail-page");
            var currentUserId = pageContainer ? pageContainer.getAttribute("data-current-user-id") : null;
            var currentTeamId = pageContainer ? pageContainer.getAttribute("data-current-team-id") : null;

            // Sync Salesperson from main detail form if selected or fallback to logged-in user
            var formUserSelect = document.querySelector('form#crm_detail_form select[name="user_id"]');
            var formUserHidden = document.querySelector('form#crm_detail_form input[type="hidden"][name="user_id"]');
            var selectedUserVal = (formUserSelect && formUserSelect.value) || (formUserHidden && formUserHidden.value) || currentUserId;
            if (modalUserInput && selectedUserVal) {
                modalUserInput.value = selectedUserVal;
            }

            // Sync Sales Team from main detail form if selected or fallback to logged-in user's team
            var formTeamSelect = document.querySelector('form#crm_detail_form select[name="team_id"]');
            var selectedTeamVal = (formTeamSelect && formTeamSelect.value) || currentTeamId;
            if (modalTeamInput && selectedTeamVal) {
                modalTeamInput.value = selectedTeamVal;
            }

            // Sync Customer from main detail form if selected
            var formCustSelect = document.getElementById("crm_partner_id_select") || document.getElementById("crm_lead_partner_id_select") || document.querySelector('.crm-customer-select');
            if (formCustSelect && modalPartnerSelect && formCustSelect.value) {
                modalPartnerSelect.value = formCustSelect.value;
                var existRadio = modal.querySelector('input[name="customer_action"][value="exist"]');
                if (existRadio) {
                    existRadio.checked = true;
                    updateCustAction();
                }
            }
        }

        function updateConvAction() {
            var selected = "convert";
            convRadios.forEach(function (r) {
                if (r.checked) selected = r.value;
            });
            if (selected === "merge") {
                if (mergeWrapper) mergeWrapper.classList.remove("d-none");
                if (custWrapper) custWrapper.classList.add("d-none");
            } else {
                if (mergeWrapper) mergeWrapper.classList.add("d-none");
                if (custWrapper) custWrapper.classList.remove("d-none");
            }
        }

        function updateCustAction() {
            var selected = "create";
            custRadios.forEach(function (r) {
                if (r.checked) selected = r.value;
            });
            if (selected === "exist") {
                if (partnerBox) partnerBox.classList.remove("d-none");
            } else {
                if (partnerBox) partnerBox.classList.add("d-none");
            }
        }

        convRadios.forEach(function (r) {
            r.addEventListener("change", updateConvAction);
        });

        custRadios.forEach(function (r) {
            r.addEventListener("change", updateCustAction);
        });

        // Auto-fetch on initial page load
        syncFromFormToModal();

        // Auto-fetch whenever user types or changes Company Name on the main form
        var formPartnerInput = document.getElementById("crm_partner_name") || document.querySelector('input[name="partner_name"]');
        if (formPartnerInput) {
            formPartnerInput.addEventListener("input", function () {
                if (modalCompanyInput) modalCompanyInput.value = (this.value || "").trim();
            });
            formPartnerInput.addEventListener("change", function () {
                if (modalCompanyInput) modalCompanyInput.value = (this.value || "").trim();
            });
        }

        // Two-way sync: if user edits Company Name in modal, sync back to form input
        if (modalCompanyInput) {
            modalCompanyInput.addEventListener("input", function () {
                if (formPartnerInput) formPartnerInput.value = (this.value || "").trim();
            });
        }

        // Auto-fetch on clicking convert buttons
        var convertBtns = document.querySelectorAll('.crm-btn-convert, [data-bs-target="#crmConvertModal"]');
        convertBtns.forEach(function (btn) {
            btn.addEventListener("click", function () {
                syncFromFormToModal();
            });
        });

        // Auto-fetch on Bootstrap modal events
        modal.addEventListener("show.bs.modal", syncFromFormToModal);
        modal.addEventListener("shown.bs.modal", syncFromFormToModal);

        // On modal form submit, ensure company name and main form inputs are synced
        var modalForm = modal.querySelector("form");
        if (modalForm) {
            modalForm.addEventListener("submit", function () {
                var compVal = modalCompanyInput ? modalCompanyInput.value.trim() : fetchCompanyFromForm();
                if (modalCompanyInput) modalCompanyInput.value = compVal;
                if (formPartnerInput) formPartnerInput.value = compVal;

                var mainForm = document.getElementById("crm_detail_form") || document.querySelector("form.crm-detail-card");
                if (mainForm) {
                    ["partner_name", "contact_name", "email_from", "phone", "website", "street", "street2", "city", "zip", "state_id", "country_id"].forEach(function (fn) {
                        var mainInput = mainForm.querySelector('[name="' + fn + '"]');
                        if (mainInput && mainInput.value) {
                            var existingHidden = modalForm.querySelector('input[type="hidden"][name="' + fn + '"]');
                            if (!existingHidden) {
                                existingHidden = document.createElement("input");
                                existingHidden.type = "hidden";
                                existingHidden.name = fn;
                                modalForm.appendChild(existingHidden);
                            }
                            existingHidden.value = mainInput.value;
                        }
                    });
                }
            });
        }

        updateConvAction();
        updateCustAction();
    }

    var markWonForm = document.getElementById("crm_mark_won_form");
    if (markWonForm) {
        markWonForm.addEventListener("submit", function () {
            var mainForm = document.getElementById("crm_detail_form") || document.querySelector("form.crm-detail-card");
            if (mainForm) {
                ["partner_name", "contact_name", "email_from", "phone", "user_id", "team_id"].forEach(function (fn) {
                    var mainInput = mainForm.querySelector('[name="' + fn + '"]');
                    if (mainInput && mainInput.value) {
                        var existingHidden = markWonForm.querySelector('input[name="' + fn + '"]');
                        if (!existingHidden) {
                            existingHidden = document.createElement("input");
                            existingHidden.type = "hidden";
                            existingHidden.name = fn;
                            markWonForm.appendChild(existingHidden);
                        }
                        existingHidden.value = mainInput.value.trim();
                    }
                });
            }
        });
    }

    initConvertModal();
    initTagWidgets();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPortalCRMDetail);
} else {
    initPortalCRMDetail();
}
