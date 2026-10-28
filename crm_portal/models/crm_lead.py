from odoo import  api, fields, models
from odoo.exceptions import UserError
from odoo.tools import parse_contact_from_email


class CrmLead(models.Model):
    _inherit = "crm.lead"

    user_id = fields.Many2one(
        domain="[('active', '=', True)]",
    )
    company_partner_id = fields.Many2one(
        'res.partner',
        string="Company Partner",
        domain="[('is_company', '=', True)]",
    )

    @api.depends('partner_id')
    def _compute_contact_name(self):

        for lead in self:
            if lead.partner_id:
                if not lead.partner_id.is_company:
                    lead.contact_name = lead.partner_id.name
                else:
                    lead.contact_name = False
            # If not partner_id: PRESERVE existing contact_name, do not reset to False!

    @api.depends('partner_id')
    def _compute_partner_name(self):

        for lead in self:
            if lead.partner_id:
                partner_vals = lead._prepare_partner_name_from_partner(lead.partner_id)
                if partner_vals.get('partner_name'):
                    lead.partner_name = partner_vals['partner_name']

    def _create_customer(self, with_parent=None):
        self.ensure_one()
        Partner = self.env['res.partner'].sudo()
        contact_name = self.contact_name
        if not contact_name and self.email_from:
            parsed = parse_contact_from_email(self.email_from)
            contact_name = parsed[0] if parsed else False

        company_name = (self.partner_name or '').strip()
        if not company_name and not contact_name and self.name:
            contact_name = self.name.strip()

        partner_company = False
        if with_parent:
            partner_company = with_parent
        elif company_name:
            # Search for existing company partner to prevent duplicates
            matching_company = Partner.search([
                ('name', '=ilike', company_name),
                ('is_company', '=', True),
            ], limit=1)
            if not matching_company:
                matching_company = Partner.search([
                    ('name', '=ilike', company_name),
                ], limit=1)

            if matching_company:
                partner_company = matching_company
            else:
                partner_company = Partner.create(
                    self._prepare_customer_values(company_name, is_company=True)
                )
        elif self.partner_id and self.partner_id.is_company:
            partner_company = self.partner_id
        elif self.partner_id and self.partner_id.parent_id:
            partner_company = self.partner_id.parent_id

        existing_contact = False
        if contact_name:
            # Check if contact already exists
            domain = [('name', '=ilike', contact_name.strip()), ('is_company', '=', False)]
            if partner_company:
                domain.append(('parent_id', '=', partner_company.id))
            if self.email_from:
                domain = ['|', ('email', '=ilike', self.email_from.strip())] + domain
            existing_contact = Partner.search(domain, limit=1)
            if not existing_contact and not partner_company:
                existing_contact = Partner.search([('name', '=ilike', contact_name.strip()), ('is_company', '=', False)], limit=1)
            if not existing_contact and partner_company and contact_name.strip().lower() == partner_company.name.strip().lower():
                existing_contact = partner_company
            elif not existing_contact:
                existing_contact = Partner.create(
                    self._prepare_customer_values(
                        contact_name.strip(),
                        is_company=False,
                        parent_id=partner_company.id if partner_company else False
                    )
                )

        if contact_name and existing_contact:
            return existing_contact

        if partner_company:
            return partner_company

        # If neither partner_name nor contact_name is set, fall back to self.name (standard Odoo CRM behavior)
        if self.name:
            lead_name = self.name.strip()
            existing_named = Partner.search([('name', '=ilike', lead_name)], limit=1)
            if existing_named:
                return existing_named
            return Partner.create(self._prepare_customer_values(lead_name, is_company=False))

        return self.env['res.partner']

    def _handle_customer_and_contact_mapping(self, is_won=False):

        if self.env.context.get('skip_customer_mapping'):
            return

        for lead in self.with_context(skip_customer_mapping=True):
            company_name = (lead.partner_name or '').strip()
            contact_name = (lead.contact_name or '').strip()

            if not company_name and not contact_name and lead.partner_id:
                if lead.partner_id.is_company:
                    company_name = (lead.partner_id.name or '').strip()
                else:
                    contact_name = (lead.partner_id.name or '').strip()
                    if lead.partner_id.parent_id:
                        company_name = (lead.partner_id.parent_id.name or '').strip()

            if not company_name and not contact_name and not lead.partner_id:
                continue

            Partner = self.env['res.partner'].sudo()
            target_company = False

            if company_name:
                matching_partner = Partner.search([
                    ('name', '=ilike', company_name),
                    ('is_company', '=', True),
                ], limit=1)
                if not matching_partner:
                    matching_partner = Partner.search([
                        ('name', '=ilike', company_name),
                    ], limit=1)

                if matching_partner:
                    target_company = matching_partner
                else:
                    customer_vals = {
                        'name': company_name,
                        'is_company': True,
                    }
                    if lead.phone:
                        customer_vals['phone'] = lead.phone
                    if lead.email_from:
                        customer_vals['email'] = lead.email_from
                    if lead.website:
                        customer_vals['website'] = lead.website
                    if lead.street:
                        customer_vals['street'] = lead.street
                    if lead.street2:
                        customer_vals['street2'] = lead.street2
                    if lead.city:
                        customer_vals['city'] = lead.city
                    if lead.state_id:
                        customer_vals['state_id'] = lead.state_id.id
                    if lead.zip:
                        customer_vals['zip'] = lead.zip
                    if lead.country_id:
                        customer_vals['country_id'] = lead.country_id.id
                    if lead.user_id:
                        customer_vals['user_id'] = lead.user_id.id

                    target_company = Partner.create(customer_vals)
            elif lead.partner_id and lead.partner_id.is_company:
                target_company = lead.partner_id

            target_contact = False
            if contact_name:
                domain = [('name', '=ilike', contact_name), ('is_company', '=', False)]
                if target_company:
                    domain.append(('parent_id', '=', target_company.id))
                else:
                    domain.append(('parent_id', '=', False))
                existing_contact = Partner.search(domain, limit=1)
                if not existing_contact and target_company and contact_name.lower() == target_company.name.lower():
                    target_contact = target_company
                elif not existing_contact:
                    target_contact = Partner.create({
                        'name': contact_name,
                        'is_company': False,
                        'parent_id': target_company.id if target_company else False,
                        'email': lead.email_from or False,
                        'phone': lead.phone or False,
                        'function': getattr(lead, 'function', False) or False,
                    })
                else:
                    target_contact = existing_contact
                    if target_company and not target_contact.parent_id:
                        target_contact.write({'parent_id': target_company.id})

            target_partner = target_contact or target_company

            vals_to_write = {}
            if target_partner and (not lead.partner_id or lead.partner_id.id != target_partner.id):
                vals_to_write['partner_id'] = target_partner.id
            if company_name and lead.partner_name != company_name:
                vals_to_write['partner_name'] = company_name
            elif not company_name and lead.partner_name:
                vals_to_write['partner_name'] = False
            if contact_name and lead.contact_name != contact_name:
                vals_to_write['contact_name'] = contact_name
            elif not contact_name and lead.contact_name:
                vals_to_write['contact_name'] = False
            if 'company_partner_id' in lead._fields:
                target_comp_id = target_company.id if target_company else False
                if lead.company_partner_id.id != target_comp_id:
                    vals_to_write['company_partner_id'] = target_comp_id

            if vals_to_write:
                lead.sudo().write(vals_to_write)

    def _handle_won_customer_mapping(self):
        return self._handle_customer_and_contact_mapping(is_won=True)

    def _auto_assign_won_customer(self):
        return self._handle_customer_and_contact_mapping(is_won=True)

    def _is_won_stage(self):
        self.ensure_one()
        return bool(
            (self.stage_id and (self.stage_id.is_won or 'won' in (self.stage_id.name or '').lower()))
            or (self.probability == 100.0 and self.type == 'opportunity')
        )

    def action_set_won(self):
        res = super().action_set_won()
        for lead in self:
            lead._handle_customer_and_contact_mapping(is_won=True)
        return res

    def action_set_lost(self, **additional_values):
        for lead in self:
            if lead._is_won_stage():
                raise UserError(("Won stage opportunities cannot be converted into Lost."))
        return super().action_set_lost(**additional_values)

    def write(self, vals):
        if vals.get('lost_reason_id') or (vals.get('active') is False and not self.env.context.get('allow_won_archive')):
            for lead in self:
                if lead.type == 'opportunity' and lead._is_won_stage():
                    raise UserError(("Won stage opportunities cannot be converted into Lost."))

        if vals.get('stage_id'):
            new_stage = self.env['crm.stage'].sudo().browse(vals['stage_id']).exists()
            if new_stage and 'lost' in (new_stage.name or '').lower():
                for lead in self:
                    if lead.type == 'opportunity' and lead._is_won_stage():
                        raise UserError(("Won stage opportunities cannot be converted into Lost."))

        if vals.get('company_partner_id') and not vals.get('partner_name'):
            comp = self.env['res.partner'].sudo().browse(vals['company_partner_id']).exists()
            if comp:
                vals['partner_name'] = comp.name

        res = super().write(vals)

        for lead in self:
            is_won = bool(
                lead.stage_id and (lead.stage_id.is_won or 'won' in (lead.stage_id.name or '').lower())
            ) or (lead.probability == 100.0 and lead.type == 'opportunity')
            needs_mapping = (
                is_won
                or 'partner_name' in vals
                or 'contact_name' in vals
                or 'company_partner_id' in vals
                or (lead.type == 'opportunity' and not lead.partner_id and (lead.partner_name or lead.contact_name))
            )
            if needs_mapping:
                lead._handle_customer_and_contact_mapping(is_won=is_won)

        return res

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('company_partner_id') and not vals.get('partner_name'):
                comp = self.env['res.partner'].sudo().browse(vals['company_partner_id']).exists()
                if comp:
                    vals['partner_name'] = comp.name

        leads = super().create(vals_list)

        for lead in leads:
            is_won = bool(
                lead.stage_id and (lead.stage_id.is_won or 'won' in (lead.stage_id.name or '').lower())
            ) or (lead.probability == 100.0 and lead.type == 'opportunity')
            lead._handle_customer_and_contact_mapping(is_won=is_won)

        return leads
