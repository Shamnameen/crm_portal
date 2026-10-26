import json
from odoo import fields, http
from odoo.http import request
from odoo.tools import html2plaintext
class CRMPortal(http.Controller):

    # ============================================================
    # USER / ACCESS HELPERS
    # ============================================================

    def _is_portal_user(self):
        """Identify portal/shared users, excluding the public user."""
        user = request.env.user
        public_user = request.env.ref(
            'base.public_user',
            raise_if_not_found=False,
        )
        if public_user and user.id == public_user.id:
            return False
        return bool(user.share)

    def _is_admin(self):
        """Identify administrators."""
        return request.env.user.has_group('base.group_system')

    def _salesperson_user_id(self):
        """Find the internal salesperson matching the portal user's email, or the user themselves."""
        user = request.env.user

        if not user.share:
            return user.id

        email = (user.partner_id.email or user.login or '').strip()
        if email:
            Users = request.env['res.users'].sudo()
            salesperson = Users.search([
                ('share', '=', False),
                ('active', '=', True),
                ('partner_id.email', '=ilike', email),
            ], limit=1)

            if not salesperson:
                salesperson = Users.search([
                    ('share', '=', False),
                    ('active', '=', True),
                    ('login', '=ilike', email),
                ], limit=1)

            if salesperson:
                return salesperson.id

        return user.id

    def _lead_domain(self):

        if self._is_admin():
            return []

        user = request.env.user
        salesperson_id = self._salesperson_user_id()

        # Portal user can see opportunities assigned directly to them.
        conditions = [
            ('create_uid', '=', user.id),
            ('user_id', '=', user.id),
        ]

        # Preserve the existing internal-salesperson mapping if one exists.
        if salesperson_id and salesperson_id != user.id:
            conditions.append(('user_id', '=', salesperson_id))

        # Build an OR domain from all permitted conditions.
        if len(conditions) == 2:
            return ['|', conditions[0], conditions[1]]

        return [
            '|', '|',
            conditions[0],
            conditions[1],
            conditions[2],
        ]

    def _get_accessible_lead(self, lead_id):
        """Return a lead only if the current user may access it."""
        Lead = request.env['crm.lead'].sudo().with_context(
            active_test=False
        )

        try:
            lead_id = int(lead_id)
        except (TypeError, ValueError):
            return Lead.browse()

        lead = Lead.browse(lead_id).exists()
        if not lead:
            return Lead.browse()

        if self._is_admin():
            return lead

        user = request.env.user
        salesperson_id = self._salesperson_user_id()

        # The portal user may access leads they created.
        if lead.create_uid.id == user.id:
            return lead

        # They may also access leads assigned to them directly as salesperson (Fixes 404 error).
        if lead.user_id.id == user.id:
            return lead

        # They may also access leads assigned to their salesperson.
        if salesperson_id and lead.user_id.id == salesperson_id:
            return lead

        return Lead.browse()

    # ============================================================
    # SAFE VALUE HELPERS
    # ============================================================

    def _safe_float(self, value):
        try:
            return float(value or 0)
        except (ValueError, TypeError):
            return 0.0

    def _safe_int(self, value):
        try:
            return int(value)
        except (ValueError, TypeError):
            return False

    def _safe_date(self, value):
        if not value:
            return False
        try:
            return fields.Date.to_date(value)
        except (ValueError, TypeError):
            return False

    def _safe_priority(self, value):
        value = str(value or '0')
        return value if value in ('0', '1', '2', '3') else '0'

    def _partner_values_from_post(self, post):
        """Return allowed contact fields submitted by the portal user."""
        values = {}

        text_fields = {
            'partner_street': 'street',
            'partner_street2': 'street2',
            'partner_city': 'city',
            'partner_zip': 'zip',
            'partner_function': 'function',
            'partner_website': 'website',
        }

        for post_name, field_name in text_fields.items():
            if post_name in post:
                values[field_name] = (
                    post.get(post_name) or ''
                ).strip()

        if 'partner_state_id' in post:
            state_id = self._safe_int(post.get('partner_state_id'))
            state = (
                request.env['res.country.state'].sudo()
                .browse(state_id).exists()
                if state_id else False
            )
            values['state_id'] = state.id if state else False

        if 'partner_country_id' in post:
            country_id = self._safe_int(post.get('partner_country_id'))
            country = (
                request.env['res.country'].sudo()
                .browse(country_id).exists()
                if country_id else False
            )
            values['country_id'] = country.id if country else False

        return values

    # ============================================================
    # PIPELINE PAGE
    # ============================================================

    @http.route(
        '/my/crm',
        type='http',
        auth='user',
        website=True,
    )
    def my_crm(self, **kwargs):
        if not self._is_portal_user() and not self._is_admin():
            return request.not_found()

        return request.render(
            'crm_portal.portal_my_crm',
            {'can_edit': True},
        )

    # ============================================================
    # CRM DATA FOR OWL
    # ============================================================

    @http.route(
        '/my/crm/data',
        type='jsonrpc',
        auth='user',
        website=True,
    )
    def crm_data(self, **kwargs):
        user = request.env.user

        Lead = request.env['crm.lead'].sudo().with_context(
            active_test=False
        )
        Stage = request.env['crm.stage'].sudo()

        domain = self._lead_domain()

        leads = Lead.search(
            domain,
            order='stage_id, priority desc, id desc',
        )
        stages = Stage.search([], order='sequence, id')

        def many2one_value(record):
            if not record:
                return False
            name = record.display_name or ''
            if getattr(record, '_name', '') == 'crm.stage' and name.strip().lower() == 'proposition':
                name = 'Proposal'
            return [record.id, name]

        return {
            'can_edit': True,
            'current_user_id': user.id,
            'current_partner_id': user.partner_id.id,
            'current_user_name': user.name or '',
            'currency_symbol': (
                    request.env.company.currency_id.symbol or '$'
            ),
            'leads': [
                {
                    'id': lead.id,
                    'type': lead.type or 'lead',
                    'active': bool(lead.active),
                    'is_lost': bool(
                        not lead.active
                        or getattr(lead, 'lost_reason_id', False)
                    ),
                    'name': lead.name or '',
                    'partner_id': many2one_value(lead.partner_id),
                    'partner_name': lead.partner_name or '',
                    'company_partner_id': many2one_value(lead.company_partner_id),
                    'contact_name': lead.contact_name or '',
                    'email_from': lead.email_from or '',
                    'phone': lead.phone or '',
                    'website': lead.website or '',
                    'expected_revenue': lead.expected_revenue or 0,
                    'probability': lead.probability or 0,
                    'stage_id': many2one_value(lead.stage_id),
                    'priority': lead.priority or '0',
                    'user_id': many2one_value(lead.user_id),
                    'team_id': many2one_value(lead.team_id),
                    'date_deadline': (
                        fields.Date.to_string(lead.date_deadline)
                        if lead.date_deadline else False
                    ),
                }
                for lead in leads
            ],
            'stages': [
                {
                    'id': stage.id,
                    'name': 'Proposal' if (stage.name or '').strip().lower() == 'proposition' else (stage.name or ''),
                    'sequence': stage.sequence,
                    'fold': stage.fold,
                }
                for stage in stages
            ],
        }

    # ============================================================
    # NEW LEAD / OPPORTUNITY PAGE
    # ============================================================

    @http.route(
        ['/my/crm/new', '/my/crm/new/lead', '/my/crm/new-lead'],
        type='http',
        auth='user',
        website=True,
        methods=['GET'],
    )
    def crm_new(self, **kwargs):
        if not self._is_portal_user() and not self._is_admin():
            return request.not_found()

        path = request.httprequest.path
        if 'lead' in path:
            record_type = 'lead'
        else:
            record_type = kwargs.get('type')
            if record_type != 'lead':
                record_type = 'opportunity'

        partner = request.env.user.partner_id.sudo()
        stages = request.env['crm.stage'].sudo().search(
            [], order='sequence, id'
        )
        salesperson_id = self._salesperson_user_id()
        mapped_salesperson = (
            request.env['res.users'].sudo().browse(salesperson_id)
            if salesperson_id else False
        )
        is_admin = self._is_admin()

        public_user_id = request.env.ref('base.public_user', raise_if_not_found=False)
        salesperson_domain = [('active', '=', True)]
        if public_user_id:
            salesperson_domain.append(('id', '!=', public_user_id.id))

        salespersons = request.env['res.users'].sudo().search(
            salesperson_domain, order='name'
        )
        if request.env.user and request.env.user not in salespersons:
            salespersons = request.env.user | salespersons

        user_team_id = getattr(request.env.user, 'sale_team_id', False) and request.env.user.sale_team_id.id or False
        current_user_id = request.env.user.id
        current_team_id = user_team_id

        all_customers = request.env['res.partner'].sudo().search(
            [], order='name'
        )

        lead = request.env['crm.lead']

        if lead and lead.partner_id and lead.partner_id not in all_customers:
            all_customers = lead.partner_id | all_customers

        companies = request.env['res.partner'].sudo().search([
            ('is_company', '=', True)
        ], order='name')


        companies_data = []
        for comp in companies:
            children = request.env['res.partner'].sudo().search([
                ('parent_id', '=', comp.id),
                ('active', '=', True),
            ], order='id desc')
            child_list = [
                {
                    'id': ch.id,
                    'name': ch.name or '',
                    'email': ch.email or '',
                    'phone': ch.phone or '',
                    'function': ch.function or '',
                }
                for ch in children
            ]
            companies_data.append({
                'id': comp.id,
                'name': comp.name or '',
                'street': comp.street or '',
                'street2': comp.street2 or '',
                'city': comp.city or '',
                'zip': comp.zip or '',
                'state_id': comp.state_id.id if comp.state_id else False,
                'country_id': comp.country_id.id if comp.country_id else False,
                'website': comp.website or '',
                'phone': comp.phone or '',
                'email': comp.email or '',
                'contacts': child_list,
            })
        companies_json = json.dumps(companies_data)

        all_customers_data = [
            {
                'id': c.id,
                'name': c.name or '',
                'email': c.email or '',
                'phone': c.phone or '',
                'website': c.website or '',
                'function': c.function or '',
                'street': c.street or '',
                'street2': c.street2 or '',
                'city': c.city or '',
                'zip': c.zip or '',
                'state_id': c.state_id.id if c.state_id else False,
                'country_id': c.country_id.id if c.country_id else False,
                'is_company': bool(c.is_company),
                'parent_id': c.parent_id.id if c.parent_id else False,
                'parent_name': (c.parent_id.name or '') if c.parent_id else '',
            }
            for c in all_customers
        ]
        all_customers_json = json.dumps(all_customers_data)

        states = request.env['res.country.state'].sudo().search(
            [('country_id', '=', partner.country_id.id)]
            if partner.country_id else [],
            order='name',
        )
        if not states:
            states = request.env['res.country.state'].sudo().search([], order='name')

        return request.render(
            'crm_portal.portal_crm_new',
            {
                'record_type': record_type,
                'partner': partner,
                'stages': stages,
                'default_stage': stages[:1],
                'countries': request.env['res.country'].sudo().search(
                    [], order='name'
                ),
                'states': states,
                'teams': request.env['crm.team'].sudo().search(
                    [], order='name'
                ),
                'tags': request.env['crm.tag'].sudo().search(
                    [], order='name'
                ),
                'companies_list': request.env['res.company'].sudo().search(
                    [], order='name'
                ),
                'campaigns': request.env['utm.campaign'].sudo().search(
                    [], order='name'
                ),
                'mediums': request.env['utm.medium'].sudo().search(
                    [], order='name'
                ),
                'sources': request.env['utm.source'].sudo().search(
                    [], order='name'
                ),
                'currency_symbol': (
                    request.env.company.currency_id.symbol or '$'
                ),
                'can_edit': True,
                'is_admin': is_admin,
                'salespersons': salespersons,
                'current_user_id': current_user_id,
                'current_team_id': current_team_id,
                'customers': all_customers,
                'top_customers': all_customers,
                'all_customers': all_customers,
                'all_customers_json': all_customers_json,
                'companies': companies,
                'companies_json': companies_json,
                'mapped_salesperson': mapped_salesperson,
            },
        )

    # ============================================================
    # CREATE LEAD / OPPORTUNITY
    # ============================================================

    @http.route(
        '/my/crm/create',
        type='http',
        auth='user',
        website=True,
        methods=['POST'],
        csrf=True,
    )
    def create_crm_lead(self, **post):
        """Create a lead or opportunity from the portal form."""
        user = request.env.user

        if not self._is_portal_user() and not self._is_admin():
            return request.not_found()

        name = (post.get('name') or '').strip()
        record_type = (post.get('type') or 'opportunity').strip()
        if record_type != 'lead':
            record_type = 'opportunity'

        if not name:
            return request.redirect('/my/crm/new?type=%s&error=missing_name' % record_type)

        Stage = request.env['crm.stage'].sudo()
        stage_id = self._safe_int(post.get('stage_id'))
        stage = Stage.browse(stage_id).exists() if stage_id else False

        if not stage and record_type == 'opportunity':
            stage = Stage.search(
                [], order='sequence, id', limit=1
            )

        if not stage and record_type == 'opportunity':
            return request.redirect('/my/crm/new?error=no_stage')

        partner = user.partner_id.sudo()
        salesperson_id = self._salesperson_user_id()

        # Determine customer (partner_id)
        assigned_partner_id = self._safe_int(post.get('partner_id'))
        lead_partner = False
        if assigned_partner_id:
            lead_partner = request.env['res.partner'].sudo().browse(assigned_partner_id).exists()

        company_partner_id = self._safe_int(post.get('company_partner_id'))
        company_partner = False
        if company_partner_id:
            company_partner = request.env['res.partner'].sudo().browse(company_partner_id).exists()

        partner_name = (post.get('partner_name') or '').strip()
        if company_partner and not partner_name:
            partner_name = company_partner.name

        contact_name = (post.get('contact_name') or '').strip()
        email_from = (post.get('email_from') or '').strip()
        phone = (post.get('phone') or '').strip()
        website = (post.get('website') or '').strip()

        if partner_name and not lead_partner and (record_type == 'opportunity' and stage and (stage.is_won or 'won' in (stage.name or '').lower())):
            Partner = request.env['res.partner'].sudo()
            matching_comp = Partner.search([
                ('name', '=ilike', partner_name),
                ('is_company', '=', True),
            ], limit=1)
            if not matching_comp:
                matching_comp = Partner.search([
                    ('name', '=ilike', partner_name),
                ], limit=1)
            if not matching_comp:
                matching_comp = Partner.create({
                    'name': partner_name,
                    'is_company': True,
                    'customer_rank': 1,
                })
            lead_partner = matching_comp

        if lead_partner:
            if not partner_name and lead_partner.is_company and lead_partner.name:
                partner_name = lead_partner.name
            if not contact_name and not lead_partner.is_company and lead_partner.name:
                contact_name = lead_partner.name
            if not email_from and lead_partner.email:
                email_from = lead_partner.email
            if not phone and lead_partner.phone:
                phone = lead_partner.phone
            if not website and lead_partner.website:
                website = lead_partner.website

        probability = max(
            0.0,
            min(100.0, self._safe_float(post.get('probability'))),
        )

        function = (post.get('function') or post.get('partner_function') or '').strip()
        street = (post.get('street') or post.get('partner_street') or '').strip()
        street2 = (post.get('street2') or post.get('partner_street2') or '').strip()
        city = (post.get('city') or post.get('partner_city') or '').strip()
        zip_code = (post.get('zip') or post.get('partner_zip') or '').strip()
        state_id = self._safe_int(post.get('state_id') or post.get('partner_state_id'))
        country_id = self._safe_int(post.get('country_id') or post.get('partner_country_id'))
        team_id = self._safe_int(post.get('team_id'))
        if not team_id:
            team_id = getattr(user, 'sale_team_id', False) and user.sale_team_id.id or False
        campaign_id = self._safe_int(post.get('campaign_id'))
        medium_id = self._safe_int(post.get('medium_id'))
        source_id = self._safe_int(post.get('source_id'))
        referred = (post.get('referred') or '').strip()
        target_company_id = self._safe_int(post.get('company_id'))

        values = {
            'name': name,
            'type': record_type,
            'partner_id': lead_partner.id if lead_partner else False,
            'company_partner_id': company_partner.id if company_partner else False,
            'partner_name': partner_name or False,
            'contact_name': contact_name or False,
            'email_from': email_from or False,
            'phone': phone or False,
            'website': website or False,
            'function': function or False,
            'street': street or False,
            'street2': street2 or False,
            'city': city or False,
            'zip': zip_code or False,
            'state_id': state_id if state_id else False,
            'country_id': country_id if country_id else False,
            'team_id': team_id if team_id else False,
            'campaign_id': campaign_id if campaign_id else False,
            'medium_id': medium_id if medium_id else False,
            'source_id': source_id if source_id else False,
            'referred': referred or False,
            'expected_revenue': self._safe_float(
                post.get('expected_revenue')
            ),
            'probability': probability,
            'date_deadline': self._safe_date(
                post.get('date_deadline')
            ),
            'priority': self._safe_priority(post.get('priority')),
            'description': '<p>%s</p>' % (post.get('description') or '').strip() if (post.get('description') or '').strip() else '',
            'company_id': target_company_id or request.env.company.id,
        }

        # Handle tag_ids
        if 'has_tags_field' in post or 'tag_ids' in request.httprequest.form:
            raw_tags = request.httprequest.form.getlist('tag_ids') if hasattr(request.httprequest.form, 'getlist') else []
            tag_ids = [int(tid) for tid in raw_tags if str(tid).isdigit()]
            values['tag_ids'] = [(6, 0, tag_ids)]
        elif post.get('tag_id'):
            single_tag = self._safe_int(post.get('tag_id'))
            if single_tag:
                values['tag_ids'] = [(6, 0, [single_tag])]

        if stage and record_type == 'opportunity':
            values['stage_id'] = stage.id


        if self._is_admin():
            if 'user_id' in post:
                assigned_user_id = self._safe_int(post.get('user_id'))
                if assigned_user_id:
                    valid_sp = request.env['res.users'].sudo().search([
                        ('id', '=', assigned_user_id),
                        ('active', '=', True),
                    ], limit=1)
                    if valid_sp:
                        values['user_id'] = valid_sp.id
                    else:
                        values['user_id'] = user.id
                else:
                    values['user_id'] = salesperson_id or user.id
            else:
                values['user_id'] = salesperson_id or user.id
        else:
            # Regular user cannot choose salesperson - assign to mapped salesperson
            values['user_id'] = salesperson_id or user.id

        lead = request.env['crm.lead'].sudo().create(values)

        if lead_partner:
            partner_values = self._partner_values_from_post(post)
            if partner_values:
                lead_partner.write({k: v for k, v in partner_values.items() if v})

        is_won = bool(lead.stage_id and (lead.stage_id.is_won or 'won' in (lead.stage_id.name or '').lower()))
        if is_won:
            self._sync_contact_on_won(lead, post)

        if record_type == 'lead':
            return request.redirect('/my/crm?filter=leads&created=1')
        return request.redirect('/my/crm?created=1')

    # ============================================================
    # DETAIL PAGE
    # ============================================================

    @http.route(
        '/my/crm/<int:lead_id>',
        type='http',
        auth='user',
        website=True,
    )
    def crm_detail(self, lead_id, **kwargs):
        lead = self._get_accessible_lead(lead_id)
        if not lead:
            return request.not_found()

        stages = request.env['crm.stage'].sudo().search(
            [], order='sequence, id'
        )

        # Strip HTML tags from description so the textarea shows plain text
        description_text = ''
        if lead.description:
            try:
                description_text = html2plaintext(lead.description).strip()
            except Exception:
                description_text = lead.description or ''

        is_admin = self._is_admin()
        public_user_id = request.env.ref('base.public_user', raise_if_not_found=False)
        salesperson_domain = [('active', '=', True)]
        if public_user_id:
            salesperson_domain.append(('id', '!=', public_user_id.id))

        salespersons = request.env['res.users'].sudo().search(
            salesperson_domain, order='name'
        )
        if request.env.user and request.env.user not in salespersons:
            salespersons = request.env.user | salespersons

        user_team_id = getattr(request.env.user, 'sale_team_id', False) and request.env.user.sale_team_id.id or False
        current_user_id = (lead.user_id and lead.user_id.id) or request.env.user.id
        current_team_id = (
            (lead.team_id and lead.team_id.id)
            or (lead.user_id and lead.user_id.sale_team_id and lead.user_id.sale_team_id.id)
            or user_team_id
            or False
        )
        all_customers = request.env['res.partner'].sudo().search(
            [], order='name'
        )
        if 'lead' in locals() and lead.partner_id and lead.partner_id not in all_customers:
            all_customers = lead.partner_id | all_customers
        companies = request.env['res.partner'].sudo().search([
            ('is_company', '=', True)
        ], order='name')

        companies_data = []
        for comp in companies:
            children = request.env['res.partner'].sudo().search([
                ('parent_id', '=', comp.id),
                ('active', '=', True),
            ], order='id desc')
            child_list = [
                {
                    'id': ch.id,
                    'name': ch.name or '',
                    'email': ch.email or '',
                    'phone': ch.phone or '',
                    'function': ch.function or '',
                }
                for ch in children
            ]
            companies_data.append({
                'id': comp.id,
                'name': comp.name or '',
                'street': comp.street or '',
                'street2': comp.street2 or '',
                'city': comp.city or '',
                'zip': comp.zip or '',
                'state_id': comp.state_id.id if comp.state_id else False,
                'country_id': comp.country_id.id if comp.country_id else False,
                'website': comp.website or '',
                'phone': comp.phone or '',
                'email': comp.email or '',
                'contacts': child_list,
            })
        companies_json = json.dumps(companies_data)

        if lead.partner_id and lead.partner_id not in all_customers[:6]:
            top_customers = (lead.partner_id | all_customers[:6])
        else:
            top_customers = all_customers[:6]

        all_customers_data = [
            {
                'id': c.id,
                'name': c.name or '',
                'email': c.email or '',
                'phone': c.phone or '',
                'website': c.website or '',
                'function': c.function or '',
                'street': c.street or '',
                'street2': c.street2 or '',
                'city': c.city or '',
                'zip': c.zip or '',
                'state_id': c.state_id.id if c.state_id else False,
                'country_id': c.country_id.id if c.country_id else False,
                'is_company': bool(c.is_company),
                'parent_id': c.parent_id.id if c.parent_id else False,
                'parent_name': (c.parent_id.name or '') if c.parent_id else '',
            }
            for c in all_customers
        ]
        all_customers_json = json.dumps(all_customers_data)

        countries = request.env['res.country'].sudo().search([], order='name')
        states = request.env['res.country.state'].sudo().search([], order='name')
        teams = request.env['crm.team'].sudo().search([], order='name')
        tags = request.env['crm.tag'].sudo().search([], order='name')
        companies_list = request.env['res.company'].sudo().search([], order='name')
        campaigns = request.env['utm.campaign'].sudo().search([], order='name')
        mediums = request.env['utm.medium'].sudo().search([], order='name')
        sources = request.env['utm.source'].sudo().search([], order='name')

        merge_opportunities = request.env['crm.lead'].sudo()
        if lead.type == 'lead':
            merge_opportunities = request.env['crm.lead'].sudo().search([
                ('id', '!=', lead.id),
                ('type', '=', 'opportunity'),
                ('active', '=', True),
            ], limit=10, order='id desc')

        return request.render(
            'crm_portal.portal_crm_detail',
            {
                'lead': lead,
                'partner': lead.partner_id.sudo(),
                'stages': stages,
                'can_edit': True,
                'description_text': description_text,
                'is_admin': is_admin,
                'salespersons': salespersons,
                'current_user_id': current_user_id,
                'current_team_id': current_team_id,
                'customers': all_customers,
                'top_customers': all_customers,
                'all_customers': all_customers,
                'all_customers_json': all_customers_json,
                'companies': companies,
                'companies_json': companies_json,
                'countries': countries,
                'states': states,
                'teams': teams,
                'tags': tags,
                'companies_list': companies_list,
                'campaigns': campaigns,
                'mediums': mediums,
                'sources': sources,
                'merge_opportunities': merge_opportunities,
                'is_portal_user': request.env.user.has_group(
                    'base.group_portal'
                ),
                'lost_reasons': request.env[
                    'crm.lost.reason'
                ].sudo().search([], order='name'),
                'currency_symbol': (
                    request.env.company.currency_id.symbol or '$'
                ),
                'lost_error': kwargs.get('lost_error'),
            },
        )

    # ============================================================
    # CONTACT SYNC ON WON
    # ============================================================

    def _sync_contact_on_won(self, lead, post=None):
        """When an opportunity converts into won state:
        auto-assign the customer (partner_id) from company name."""
        if hasattr(lead, '_handle_won_customer_mapping'):
            lead._handle_won_customer_mapping()
        elif hasattr(lead, '_auto_assign_won_customer'):
            lead._auto_assign_won_customer()

        target_partner = lead.partner_id
        if target_partner and post:
            partner_values = self._partner_values_from_post(post)
            if partner_values:
                target_partner.write({k: v for k, v in partner_values.items() if v})

    # ============================================================
    # UPDATE LEAD / OPPORTUNITY
    # ============================================================

    @http.route(
        '/my/crm/<int:lead_id>/update',
        type='http',
        auth='user',
        website=True,
        methods=['POST'],
        csrf=True,
    )
    def update_crm_lead(self, lead_id, **post):
        if not self._is_portal_user() and not self._is_admin():
            return request.not_found()

        lead = self._get_accessible_lead(lead_id)
        if not lead:
            return request.not_found()

        name = (post.get('name') or '').strip() or lead.name
        probability = max(
            0.0,
            min(100.0, self._safe_float(post.get('probability'))),
        )

        values = {
            'name': name,
            'contact_name': (post.get('contact_name') or '').strip(),
            'email_from': (post.get('email_from') or '').strip(),
            'phone': (post.get('phone') or '').strip(),
            'website': (post.get('website') or '').strip(),
            'expected_revenue': self._safe_float(
                post.get('expected_revenue')
            ),
            'probability': probability,
            'date_deadline': self._safe_date(
                post.get('date_deadline')
            ),
            'priority': self._safe_priority(post.get('priority')),
            'description': '<p>%s</p>' % (post.get('description') or '').strip() if (post.get('description') or '').strip() else '',
        }

        # Function (Job Position)
        if 'function' in post or 'partner_function' in post:
            values['function'] = (post.get('function') or post.get('partner_function') or '').strip()

        # Address fields
        if 'street' in post or 'partner_street' in post:
            values['street'] = (post.get('street') or post.get('partner_street') or '').strip()
        if 'street2' in post or 'partner_street2' in post:
            values['street2'] = (post.get('street2') or post.get('partner_street2') or '').strip()
        if 'city' in post or 'partner_city' in post:
            values['city'] = (post.get('city') or post.get('partner_city') or '').strip()
        if 'zip' in post or 'partner_zip' in post:
            values['zip'] = (post.get('zip') or post.get('partner_zip') or '').strip()
        if 'state_id' in post or 'partner_state_id' in post:
            values['state_id'] = self._safe_int(post.get('state_id') or post.get('partner_state_id')) or False
        if 'country_id' in post or 'partner_country_id' in post:
            values['country_id'] = self._safe_int(post.get('country_id') or post.get('partner_country_id')) or False

        # Sales Team
        if 'team_id' in post:
            team_id = self._safe_int(post.get('team_id'))
            values['team_id'] = team_id if team_id else False
        elif not lead.team_id:
            user_team_id = getattr(request.env.user, 'sale_team_id', False) and request.env.user.sale_team_id.id or False
            if user_team_id:
                values['team_id'] = user_team_id

        # Tags
        if 'has_tags_field' in post or 'tag_ids' in request.httprequest.form:
            raw_tags = request.httprequest.form.getlist('tag_ids') if hasattr(request.httprequest.form, 'getlist') else []
            tag_ids = [int(tid) for tid in raw_tags if str(tid).isdigit()]
            values['tag_ids'] = [(6, 0, tag_ids)]
        elif 'tag_id' in post:
            single_tag = self._safe_int(post.get('tag_id'))
            values['tag_ids'] = [(6, 0, [single_tag])] if single_tag else [(5, 0, 0)]

        # Marketing fields
        if 'campaign_id' in post:
            values['campaign_id'] = self._safe_int(post.get('campaign_id')) or False
        if 'medium_id' in post:
            values['medium_id'] = self._safe_int(post.get('medium_id')) or False
        if 'source_id' in post:
            values['source_id'] = self._safe_int(post.get('source_id')) or False
        if 'referred' in post:
            values['referred'] = (post.get('referred') or '').strip()
        if 'company_id' in post:
            comp_id = self._safe_int(post.get('company_id'))
            if comp_id:
                values['company_id'] = comp_id

        stage_id = self._safe_int(post.get('stage_id'))
        stage = False
        if stage_id:
            stage = request.env['crm.stage'].sudo().browse(
                stage_id
            ).exists()
            if stage:
                is_currently_won = bool(
                    (lead.stage_id and (lead.stage_id.is_won or 'won' in (lead.stage_id.name or '').lower()))
                    or (lead.probability == 100.0 and lead.type == 'opportunity')
                )
                if is_currently_won and 'lost' in (stage.name or '').lower():
                    return request.redirect('/my/crm/%s?lost_error=won' % lead.id)
                values['stage_id'] = stage.id

        is_won_stage = bool(
            (stage and (stage.is_won or 'won' in (stage.name or '').lower())) or
            (lead.stage_id and (lead.stage_id.is_won or 'won' in (lead.stage_id.name or '').lower())) or
            (probability == 100.0 and lead.type == 'opportunity')
        )

        # Customer assignment (allowed for any authorized user with edit permission)
        if 'partner_id' in post:
            assigned_partner_id = self._safe_int(post.get('partner_id'))
            if assigned_partner_id:
                cust = request.env['res.partner'].sudo().browse(assigned_partner_id).exists()
                values['partner_id'] = cust.id if cust else False
            elif post.get('partner_id') == '':
                values['partner_id'] = False

        if 'company_partner_id' in post:
            company_partner_id = self._safe_int(post.get('company_partner_id'))
            values['company_partner_id'] = company_partner_id if company_partner_id else False
            if company_partner_id:
                comp = request.env['res.partner'].sudo().browse(company_partner_id).exists()
                if comp:
                    values['partner_name'] = comp.name
            elif post.get('company_partner_id') == '':
                values['company_partner_id'] = False

        if 'partner_name' in post:
            submitted_pname = (post.get('partner_name') or '').strip()
            if submitted_pname:
                values['partner_name'] = submitted_pname
            elif not lead.partner_name:
                values['partner_name'] = False

        if values.get('partner_name'):
            submitted_company = values['partner_name'].strip()
            if submitted_company and is_won_stage:
                current_pid = values.get('partner_id') or (lead.partner_id.id if lead.partner_id else False)
                current_partner = request.env['res.partner'].sudo().browse(current_pid).exists() if current_pid else False
                lead_name_str = (lead.name or '').strip().lower()
                # If partner_id is unassigned OR matches the lead name (placeholder) OR matches the company name:
                if not current_partner or (current_partner.name or '').strip().lower() == lead_name_str or (current_partner.name or '').strip().lower() == submitted_company.lower():
                    Partner = request.env['res.partner'].sudo()
                    matching_comp = Partner.search([
                        ('name', '=ilike', submitted_company),
                        ('is_company', '=', True),
                    ], limit=1)
                    if not matching_comp:
                        matching_comp = Partner.search([
                            ('name', '=ilike', submitted_company),
                        ], limit=1)
                    if not matching_comp:
                        matching_comp = Partner.create({
                            'name': submitted_company,
                            'is_company': True,
                            'customer_rank': 1,
                        })
                    values['partner_id'] = matching_comp.id

        # Server-side permission check for assigning salesperson
        if self._is_admin():
            if 'user_id' in post:
                assigned_user_id = self._safe_int(post.get('user_id'))
                if assigned_user_id:
                    valid_sp = request.env['res.users'].sudo().search([
                        ('id', '=', assigned_user_id),
                        ('active', '=', True),
                    ], limit=1)
                    if valid_sp:
                        values['user_id'] = valid_sp.id
                elif post.get('user_id') == '':
                    values['user_id'] = False
        else:
            # Regular user cannot reassign records to another salesperson, but if unassigned, auto-assign to current user
            if not lead.user_id:
                values['user_id'] = request.env.user.id
            else:
                values.pop('user_id', None)

        lead.sudo().write(values)

        target_partner = lead.partner_id
        if target_partner:
            partner_values = self._partner_values_from_post(post)
            if partner_values:
                target_partner.write({k: v for k, v in partner_values.items() if v})

        # When opportunity converts into won state: auto-assign in Contact module (res.partner)
        is_won = bool(lead.stage_id and (lead.stage_id.is_won or 'won' in (lead.stage_id.name or '').lower())) or (lead.probability == 100.0 and lead.type == 'opportunity')
        if is_won:
            lead.sudo().action_set_won()
            self._sync_contact_on_won(lead, post)

        return request.redirect('/my/crm/%s?saved=1' % lead.id)

    # ============================================================
    # CONVERT LEAD TO OPPORTUNITY
    # ============================================================

    @http.route(
        '/my/crm/<int:lead_id>/convert',
        type='http',
        auth='user',
        website=True,
        methods=['POST'],
        csrf=True,
    )
    def convert_crm_lead(self, lead_id, **post):
        """Convert an existing lead to an opportunity using custom conversion wizard options."""
        if not self._is_portal_user() and not self._is_admin():
            return request.not_found()

        lead = self._get_accessible_lead(lead_id)
        if not lead:
            return request.not_found()

        if lead.type != 'lead':
            return request.redirect('/my/crm/%s' % lead.id)

        conversion_action = post.get('conversion_action') or 'convert'
        customer_action = post.get('customer_action') or 'create'

        # 1. Salesperson & Sales Team assignment
        assign_vals = {}
        assigned_user_id = self._safe_int(post.get('user_id'))
        if assigned_user_id:
            valid_user = request.env['res.users'].sudo().browse(assigned_user_id).exists()
            if valid_user:
                assign_vals['user_id'] = valid_user.id
        else:
            assign_vals['user_id'] = lead.user_id.id if lead.user_id else request.env.user.id

        assigned_team_id = self._safe_int(post.get('team_id'))
        if assigned_team_id:
            valid_team = request.env['crm.team'].sudo().browse(assigned_team_id).exists()
            if valid_team:
                assign_vals['team_id'] = valid_team.id
        else:
            target_user = request.env['res.users'].sudo().browse(
                assign_vals.get('user_id') or (lead.user_id and lead.user_id.id) or request.env.user.id
            )
            user_team_id = getattr(target_user, 'sale_team_id', False) and target_user.sale_team_id.id
            assign_vals['team_id'] = lead.team_id.id if lead.team_id else (user_team_id or False)

        # 2. Company Name Char field preservation/transfer
        company_confirm = (
            post.get('company_name_confirm')
            or post.get('partner_name')
            or post.get('company_name')
            or lead.partner_name
            or ''
        ).strip()
        if company_confirm:
            assign_vals['partner_name'] = company_confirm

        # Also preserve any contact/address fields submitted
        for fld in ['contact_name', 'email_from', 'phone', 'website', 'street', 'street2', 'city', 'zip']:
            if fld in post and (post.get(fld) or '').strip():
                assign_vals[fld] = post.get(fld).strip()
        if 'state_id' in post and self._safe_int(post.get('state_id')):
            assign_vals['state_id'] = self._safe_int(post.get('state_id'))
        if 'country_id' in post and self._safe_int(post.get('country_id')):
            assign_vals['country_id'] = self._safe_int(post.get('country_id'))

        if assign_vals:
            lead.sudo().write(assign_vals)

        # 3. Handle Merge action
        if conversion_action == 'merge':
            raw_dup = request.httprequest.form.getlist('duplicated_lead_ids') if hasattr(request.httprequest.form, 'getlist') else []
            dup_ids = [int(i) for i in raw_dup if str(i).isdigit()]
            if dup_ids:
                to_merge = (lead | request.env['crm.lead'].sudo().browse(dup_ids))
                lead = to_merge.merge_opportunity(auto_unlink=False)

        # 4. Handle Customer action
        if customer_action == 'exist':
            existing_partner_id = self._safe_int(post.get('partner_id'))
            if existing_partner_id:
                partner = request.env['res.partner'].sudo().browse(existing_partner_id).exists()
                if partner:
                    pname = partner.name if partner.is_company else (partner.parent_id.name if partner.parent_id else partner.name)
                    lead.sudo().write({
                        'partner_id': partner.id,
                        'partner_name': pname or lead.partner_name,
                    })
        elif customer_action == 'create':
            comp_name = (company_confirm or lead.partner_name or '').strip()
            contact_name = (post.get('contact_name') or lead.contact_name or '').strip()

            lead.sudo().write({
                'partner_name': comp_name or False,
                'contact_name': contact_name or False,
                'partner_id': False,
            })
        elif customer_action == 'nothing':
            # Do not link to a customer
            lead.sudo().write({'partner_id': False})

        # 5. Convert type to opportunity
        if not lead.stage_id:
            stage = request.env['crm.stage'].sudo().search(
                [], order='sequence, id', limit=1
            )
            lead.sudo().write({
                'type': 'opportunity',
                'stage_id': stage.id if stage else False,
            })
        else:
            lead.sudo().write({'type': 'opportunity'})

        # If converted opportunity is in won stage, trigger won customer mapping
        is_won = bool(lead.stage_id and (lead.stage_id.is_won or 'won' in (lead.stage_id.name or '').lower()))
        if is_won:
            self._sync_contact_on_won(lead)

        return request.redirect('/my/crm/%s?converted=1' % lead.id)

    # ============================================================
    # MARK WON / MARK LOST / RESTORE OPPORTUNITY
    # ============================================================

    @http.route(
        '/my/crm/<int:lead_id>/mark-won',
        type='http',
        auth='user',
        website=True,
        methods=['POST'],
        csrf=True,
    )
    def mark_crm_lead_won(self, lead_id, **post):
        if not self._is_portal_user() and not self._is_admin():
            return request.not_found()
        lead = self._get_accessible_lead(lead_id)
        if not lead:
            return request.not_found()

        won_stage = request.env['crm.stage'].sudo().search([
            ('is_won', '=', True)
        ], limit=1)
        if not won_stage:
            won_stage = request.env['crm.stage'].sudo().search([
                ('name', 'ilike', 'won')
            ], limit=1)

        vals = {'probability': 100.0, 'lost_reason_id': False}
        if won_stage:
            vals['stage_id'] = won_stage.id
        if not lead.user_id:
            vals['user_id'] = request.env.user.id
        if not lead.team_id:
            user_team_id = getattr(request.env.user, 'sale_team_id', False) and request.env.user.sale_team_id.id or False
            if user_team_id:
                vals['team_id'] = user_team_id
        pname = (post.get('partner_name') or lead.partner_name or '').strip()
        cname = (post.get('contact_name') or lead.contact_name or '').strip()
        if pname:
            vals['partner_name'] = pname
        if cname:
            vals['contact_name'] = cname
        lead.sudo().write(vals)

        lead.sudo().action_set_won()
        self._sync_contact_on_won(lead, post)

        return request.redirect('/my/crm/%s?saved=1' % lead.id)

    @http.route(
        '/my/crm/<int:lead_id>/mark-lost',
        type='http',
        auth='user',
        website=True,
        methods=['POST'],
        csrf=True,
    )
    def mark_crm_lead_lost(self, lead_id, **post):
        lead = self._get_accessible_lead(lead_id)
        if not lead:
            return request.not_found()

        # Won stage validation: won stage opportunity cannot convert into lost
        is_won = bool(
            (lead.stage_id and (lead.stage_id.is_won or 'won' in (lead.stage_id.name or '').lower()))
            or (lead.probability == 100.0 and lead.type == 'opportunity')
        )
        if is_won:
            return request.redirect(
                '/my/crm/%s?lost_error=won' % lead.id
            )

        reason_id = self._safe_int(post.get('lost_reason_id'))
        if not reason_id:
            return request.redirect(
                '/my/crm/%s?lost_error=reason' % lead.id
            )

        reason = request.env['crm.lost.reason'].sudo().browse(
            reason_id
        ).exists()
        if not reason:
            return request.redirect(
                '/my/crm/%s?lost_error=reason' % lead.id
            )

        wizard = request.env['crm.lead.lost'].sudo().create({
            'lead_ids': [(6, 0, [lead.id])],
            'lost_reason_id': reason.id,
            'lost_feedback': (
                post.get('lost_feedback') or ''
            ).strip(),
        })
        wizard.action_lost_reason_apply()

        return request.redirect('/my/crm')

    @http.route(
        '/my/crm/<int:lead_id>/restore',
        type='http',
        auth='user',
        website=True,
        methods=['POST'],
        csrf=True,
    )
    def restore_crm_lead(self, lead_id, **post):
        lead = self._get_accessible_lead(lead_id)
        if not lead:
            return request.not_found()

        lead.sudo().write({'active': True})
        return request.redirect(
            '/my/crm/%s?restored=1' % lead.id
        )

    # ============================================================
    # DRAG / DROP STAGE CHANGE
    # ============================================================

    @http.route(
        '/my/crm/move-stage',
        type='jsonrpc',
        auth='user',
        website=True,
        methods=['POST'],
    )
    def move_stage(self, lead_id=None, stage_id=None, **kwargs):
        lead = self._get_accessible_lead(lead_id)
        if not lead:
            return {
                'success': False,
                'error': 'You cannot access this opportunity.',
            }

        # Requirement: remove the lost drag drop option. Only button for the lost.
        if stage_id == 'lost' or str(stage_id).lower() == 'lost':
            return {
                'success': False,
                'error': 'Opportunities cannot be moved to Lost via drag and drop. Please use the Mark Lost button.',
            }

        # Requirement: won stage opportunity cannot convert into lost
        is_won_lead = bool(
            (lead.stage_id and (lead.stage_id.is_won or 'won' in (lead.stage_id.name or '').lower()))
            or (lead.probability == 100.0 and lead.type == 'opportunity')
        )

        try:
            stage_id = int(stage_id)
        except (TypeError, ValueError):
            return {
                'success': False,
                'error': 'Invalid stage.',
            }

        stage = request.env['crm.stage'].sudo().browse(
            stage_id
        ).exists()
        if not stage:
            return {
                'success': False,
                'error': 'Stage not found.',
            }

        if is_won_lead and 'lost' in (stage.name or '').lower():
            return {
                'success': False,
                'error': 'Won stage opportunities cannot be converted into Lost.',
            }

        vals = {'stage_id': stage.id}
        if not lead.active:
            vals['active'] = True
            vals['lost_reason_id'] = False
        if not lead.user_id:
            vals['user_id'] = request.env.user.id
        if not lead.team_id:
            user_team_id = getattr(request.env.user, 'sale_team_id', False) and request.env.user.sale_team_id.id or False
            if user_team_id:
                vals['team_id'] = user_team_id
        lead.sudo().write(vals)

        is_won = bool(stage.is_won or 'won' in (stage.name or '').lower())
        if is_won:
            lead.sudo().action_set_won()
            self._sync_contact_on_won(lead)

        lead = lead.sudo()
        stage_name = stage.name or ''
        if stage_name.strip().lower() == 'proposition':
            stage_name = 'Proposal'

        return {
            'success': True,
            'lead_id': lead.id,
            'stage_id': stage.id,
            'stage': [stage.id, stage_name],
            'partner_id': [lead.partner_id.id, lead.partner_id.display_name] if lead.partner_id else False,
            'partner_name': lead.partner_name or '',
            'contact_name': lead.contact_name or '',
            'email_from': lead.email_from or '',
            'phone': lead.phone or '',
        }
