import type { TableData } from '$lib/types';

export const sampleTables: Record<'saas' | 'sales' | 'inventory', TableData> = {
	saas: {
		title: 'SaaS Revenue & Retention',
		columns: [
			{ id: 'c1', name: 'Product Plan', type: 'text', width: 220 },
			{ id: 'c2', name: 'Tier', type: 'dropdown', width: 130 },
			{ id: 'c3', name: 'Monthly Price', type: 'currency', width: 150 },
			{ id: 'c4', name: 'Active Accounts', type: 'number', width: 160 },
			{ id: 'c5', name: 'Churn Risk', type: 'percent', width: 140 },
			{ id: 'c6', name: 'Launch Date', type: 'date', width: 140 }
		],
		rows: [
			{ id: 'r1', c1: 'Starter Cloud', c2: 'Active', c3: 49, c4: 1250, c5: 0.045, c6: '2023-01-15' },
			{ id: 'r2', c1: 'Team Pro', c2: 'Active', c3: 199, c4: 840, c5: 0.028, c6: '2023-03-01' },
			{ id: 'r3', c1: 'Enterprise Core', c2: 'Active', c3: 999, c4: 215, c5: 0.012, c6: '2023-05-10' },
			{ id: 'r4', c1: 'AI Copilot Addon', c2: 'Trial', c3: 29, c4: 3100, c5: 0.082, c6: '2024-01-20' },
			{ id: 'r5', c1: 'Dedicated VPC', c2: 'Active', c3: 2499, c4: 48, c5: 0.005, c6: '2023-08-15' },
			{ id: 'r6', c1: 'Analytics Suite', c2: 'Pending', c3: 149, c4: 420, c5: 0.035, c6: '2024-02-01' },
			{ id: 'r7', c1: 'Custom SLA Support', c2: 'Active', c3: 500, c4: 110, c5: 0.008, c6: '2023-04-12' },
			{ id: 'r8', c1: 'Developer Sandbox', c2: 'Active', c3: 19, c4: 4500, c5: 0.125, c6: '2022-11-05' },
			{ id: 'r9', c1: 'HIPAA Compliance Pack', c2: 'Active', c3: 750, c4: 85, c5: 0.015, c6: '2023-09-22' },
			{ id: 'r10', c1: 'SOC2 Security Module', c2: 'Active', c3: 650, c4: 130, c5: 0.011, c6: '2023-10-01' },
			{ id: 'r11', c1: 'SSO & SCIM Enabler', c2: 'Active', c3: 299, c4: 670, c5: 0.022, c6: '2023-02-18' },
			{ id: 'r12', c1: 'Data Warehouse Sync', c2: 'Trial', c3: 399, c4: 290, c5: 0.054, c6: '2024-03-15' },
			{ id: 'r13', c1: 'Realtime Webhooks', c2: 'Active', c3: 79, c4: 1890, c5: 0.039, c6: '2023-06-30' },
			{ id: 'r14', c1: 'Legacy Migration Tool', c2: 'Churned', c3: 1200, c4: 12, c5: 0.285, c6: '2022-08-10' },
			{ id: 'r15', c1: 'Multi-Region Failover', c2: 'Active', c3: 1800, c4: 65, c5: 0.009, c6: '2023-11-14' },
			{ id: 'r16', c1: 'Edge Caching Node', c2: 'Active', c3: 120, c4: 980, c5: 0.031, c6: '2023-07-08' },
			{ id: 'r17', c1: 'Audit Log Vault', c2: 'Active', c3: 350, c4: 340, c5: 0.018, c6: '2023-12-05' },
			{ id: 'r18', c1: 'Automated Billing Portal', c2: 'Trial', c3: 89, c4: 510, c5: 0.063, c6: '2024-04-01' },
			{ id: 'r19', c1: 'GraphQL Mesh API', c2: 'Active', c3: 250, c4: 730, c5: 0.027, c6: '2023-05-25' },
			{ id: 'r20', c1: 'Custom Domain SSL', c2: 'Active', c3: 35, c4: 2200, c5: 0.041, c6: '2022-10-19' },
			{ id: 'r21', c1: 'Incident Commander', c2: 'Pending', c3: 450, c4: 160, c5: 0.048, c6: '2024-05-10' },
			{ id: 'r22', c1: 'Load Testing Engine', c2: 'Trial', c3: 600, c4: 95, c5: 0.075, c6: '2024-02-28' },
			{ id: 'r23', c1: 'Email Gateway Pro', c2: 'Active', c3: 110, c4: 1420, c5: 0.033, c6: '2023-04-05' },
			{ id: 'r24', c1: 'Vector DB Indexing', c2: 'Active', c3: 550, c4: 380, c5: 0.021, c6: '2024-01-10' },
			{ id: 'r25', c1: 'Zero Trust Gateway', c2: 'Active', c3: 1400, c4: 78, c5: 0.014, c6: '2023-09-01' }
		]
	},

	sales: {
		title: 'B2B Sales Pipeline',
		columns: [
			{ id: 'c1', name: 'Prospect Company', type: 'text', width: 220 },
			{ id: 'c2', name: 'Stage', type: 'dropdown', width: 150 },
			{ id: 'c3', name: 'Deal Value', type: 'currency', width: 150 },
			{ id: 'c4', name: 'Win Probability', type: 'percent', width: 160 },
			{ id: 'c5', name: 'Seats', type: 'number', width: 120 },
			{ id: 'c6', name: 'Target Close', type: 'date', width: 150 }
		],
		rows: [
			{ id: 'r1', c1: 'Apex Global Logistics', c2: 'Closed Won', c3: 85000, c4: 1.0, c5: 450, c6: '2025-01-10' },
			{ id: 'r2', c1: 'Starlight Fintech', c2: 'Negotiation', c3: 120000, c4: 0.85, c5: 600, c6: '2025-02-28' },
			{ id: 'r3', c1: 'Horizon Health Systems', c2: 'Proposal', c3: 240000, c4: 0.6, c5: 1200, c6: '2025-03-15' },
			{ id: 'r4', c1: 'Vanguard Retail Tech', c2: 'Discovery', c3: 45000, c4: 0.3, c5: 180, c6: '2025-04-01' },
			{ id: 'r5', c1: 'Quantum Robotics', c2: 'Negotiation', c3: 95000, c4: 0.8, c5: 350, c6: '2025-02-15' },
			{ id: 'r6', c1: 'BlueWave Telematics', c2: 'Closed Lost', c3: 65000, c4: 0.0, c5: 220, c6: '2025-01-20' },
			{ id: 'r7', c1: 'Acorn Media Group', c2: 'Proposal', c3: 38000, c4: 0.55, c5: 140, c6: '2025-03-30' },
			{ id: 'r8', c1: 'Pinnacle Aerospace', c2: 'Closed Won', c3: 310000, c4: 1.0, c5: 1500, c6: '2025-01-05' },
			{ id: 'r9', c1: 'Nova Payment Networks', c2: 'Negotiation', c3: 175000, c4: 0.9, c5: 800, c6: '2025-02-20' },
			{ id: 'r10', c1: 'Cobalt Energy Labs', c2: 'Discovery', c3: 52000, c4: 0.25, c5: 200, c6: '2025-04-15' },
			{ id: 'r11', c1: 'Titan Construction ERP', c2: 'Proposal', c3: 88000, c4: 0.5, c5: 320, c6: '2025-03-22' },
			{ id: 'r12', c1: 'Solaris Cloud infra', c2: 'Closed Won', c3: 145000, c4: 1.0, c5: 750, c6: '2025-01-18' },
			{ id: 'r13', c1: 'Silverline Insurance', c2: 'Negotiation', c3: 195000, c4: 0.75, c5: 950, c6: '2025-02-25' },
			{ id: 'r14', c1: 'Beacon Security Net', c2: 'Discovery', c3: 28000, c4: 0.35, c5: 90, c6: '2025-05-01' },
			{ id: 'r15', c1: 'Zenith BioPharm', c2: 'Proposal', c3: 160000, c4: 0.65, c5: 500, c6: '2025-03-10' },
			{ id: 'r16', c1: 'Vortex Gaming Studio', c2: 'Closed Won', c3: 72000, c4: 1.0, c5: 280, c6: '2025-01-25' },
			{ id: 'r17', c1: 'Kestrel Supply Chain', c2: 'Negotiation', c3: 115000, c4: 0.8, c5: 410, c6: '2025-02-18' },
			{ id: 'r18', c1: 'Aurora CleanTech', c2: 'Discovery', c3: 49000, c4: 0.2, c5: 160, c6: '2025-04-20' },
			{ id: 'r19', c1: 'Crestview Capital', c2: 'Proposal', c3: 135000, c4: 0.7, c5: 480, c6: '2025-03-25' },
			{ id: 'r20', c1: 'Echo Digital Agency', c2: 'Closed Won', c3: 32000, c4: 1.0, c5: 110, c6: '2025-01-12' },
			{ id: 'r21', c1: 'Meridian Maritime', c2: 'Negotiation', c3: 98000, c4: 0.85, c5: 390, c6: '2025-02-22' },
			{ id: 'r22', c1: 'Strata Mining Ops', c2: 'Closed Lost', c3: 210000, c4: 0.0, c5: 900, c6: '2025-01-30' },
			{ id: 'r23', c1: 'Onyx Cyber Defense', c2: 'Proposal', c3: 185000, c4: 0.6, c5: 650, c6: '2025-03-18' },
			{ id: 'r24', c1: 'Prism Data Analytics', c2: 'Discovery', c3: 58000, c4: 0.3, c5: 210, c6: '2025-04-10' },
			{ id: 'r25', c1: 'Vector Fleet Systems', c2: 'Closed Won', c3: 105000, c4: 1.0, c5: 430, c6: '2025-01-28' }
		]
	},

	inventory: {
		title: 'Hardware & Logistics Inventory',
		columns: [
			{ id: 'c1', name: 'SKU Item Name', type: 'text', width: 200 },
			{ id: 'c2', name: 'Inventory Status', type: 'dropdown', width: 140 },
			{ id: 'c3', name: 'Unit Cost', type: 'currency', width: 130 },
			{ id: 'c4', name: 'Quantity on Hand', type: 'number', width: 150 },
			{ id: 'c5', name: 'Stockout Risk', type: 'percent', width: 130 },
			{ id: 'c6', name: 'Next Restock', type: 'date', width: 140 }
		],
		rows: [
			{ id: 'r1', c1: 'ARM-64 Cortex Processor', c2: 'In Stock', c3: 145.5, c4: 1850, c5: 0.05, c6: '2025-03-01' },
			{ id: 'r2', c1: 'DDR5 32GB RAM Module', c2: 'In Stock', c3: 88.0, c4: 3200, c5: 0.08, c6: '2025-02-15' },
			{ id: 'r3', c1: 'NVMe Gen4 2TB SSD', c2: 'Low Stock', c3: 112.25, c4: 140, c5: 0.65, c6: '2025-02-05' },
			{ id: 'r4', c1: 'Gigabit Switch 48-Port', c2: 'In Stock', c3: 420.0, c4: 450, c5: 0.12, c6: '2025-03-10' },
			{ id: 'r5', c1: 'Fiber Optic Transceiver 10G', c2: 'Out of Stock', c3: 35.8, c4: 0, c5: 1.0, c6: '2025-02-02' },
			{ id: 'r6', c1: 'Redundant PSU 850W Titanium', c2: 'In Stock', c3: 165.0, c4: 620, c5: 0.15, c6: '2025-02-20' },
			{ id: 'r7', c1: 'Server Chassis 2U Rackmount', c2: 'In Stock', c3: 290.0, c4: 210, c5: 0.18, c6: '2025-03-05' },
			{ id: 'r8', c1: 'High-RPM Cooling Fan 120mm', c2: 'In Stock', c3: 14.5, c4: 4800, c5: 0.03, c6: '2025-02-28' },
			{ id: 'r9', c1: 'PCIe Riser Card Gen5', c2: 'Low Stock', c3: 42.0, c4: 85, c5: 0.72, c6: '2025-02-08' },
			{ id: 'r10', c1: 'Cat6A Shielded Patch Cable 5m', c2: 'In Stock', c3: 6.2, c4: 9500, c5: 0.01, c6: '2025-03-15' },
			{ id: 'r11', c1: 'KVM Console 17-inch LCD', c2: 'In Stock', c3: 680.0, c4: 95, c5: 0.22, c6: '2025-03-20' },
			{ id: 'r12', c1: 'Smart PDU Metered 30A', c2: 'Low Stock', c3: 340.0, c4: 35, c5: 0.8, c6: '2025-02-06' },
			{ id: 'r13', c1: 'RAID Controller SAS 12Gbps', c2: 'In Stock', c3: 275.0, c4: 310, c5: 0.14, c6: '2025-02-25' },
			{ id: 'r14', c1: 'Thermal Conductive Paste 50g', c2: 'In Stock', c3: 18.0, c4: 1200, c5: 0.04, c6: '2025-03-01' },
			{ id: 'r15', c1: 'Hardware Security Module HSM', c2: 'Out of Stock', c3: 3200.0, c4: 0, c5: 1.0, c6: '2025-02-12' },
			{ id: 'r16', c1: 'SFP28 25G Direct Attach Cable', c2: 'In Stock', c3: 54.0, c4: 780, c5: 0.09, c6: '2025-02-18' },
			{ id: 'r17', c1: 'Server Motherboard Dual Socket', c2: 'In Stock', c3: 590.0, c4: 175, c5: 0.16, c6: '2025-03-08' },
			{ id: 'r18', c1: 'ECC Registered DIMM 64GB', c2: 'Low Stock', c3: 195.0, c4: 60, c5: 0.78, c6: '2025-02-07' },
			{ id: 'r19', c1: 'Cable Management Arm 1U', c2: 'In Stock', c3: 28.5, c4: 890, c5: 0.06, c6: '2025-03-12' },
			{ id: 'r20', c1: 'Dual 100GbE NIC Optical', c2: 'In Stock', c3: 750.0, c4: 130, c5: 0.25, c6: '2025-02-22' },
			{ id: 'r21', c1: 'Rack Mount Shelf Heavy Duty', c2: 'In Stock', c3: 65.0, c4: 420, c5: 0.08, c6: '2025-03-18' },
			{ id: 'r22', c1: 'UPS Battery Module 3000VA', c2: 'Low Stock', c3: 890.0, c4: 18, c5: 0.85, c6: '2025-02-09' },
			{ id: 'r23', c1: 'Static Control Grounding Wristband', c2: 'In Stock', c3: 8.5, c4: 2400, c5: 0.02, c6: '2025-03-30' },
			{ id: 'r24', c1: 'SAS Hard Drive 16TB Enterprise', c2: 'In Stock', c3: 310.0, c4: 550, c5: 0.11, c6: '2025-02-26' },
			{ id: 'r25', c1: 'Rack Enclosure 42U Server Cabinet', c2: 'In Stock', c3: 1450.0, c4: 42, c5: 0.19, c6: '2025-03-25' }
		]
	}
};
