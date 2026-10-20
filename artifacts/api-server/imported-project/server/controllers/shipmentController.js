const { supabaseAdmin } = require('../services/db');
const { validateTrackingCode } = require('../services/trackingCodeGenerator');

async function getByCode(req,res,next) {
  try {
    const code=String(req.params.code||'').toUpperCase();
    if(!validateTrackingCode(code)) return res.status(400).json({success:false,error:'Invalid visibility code.',code:'INVALID_CODE_FORMAT'});
    const {data:shipment,error}=await supabaseAdmin.from('shipments').select('id,tracking_code,status,service_type,consignee_address_generalized,privacy_mode,current_lat,current_lng,last_verified_at,delivered_at,proof_of_delivery').eq('tracking_code',code).maybeSingle();
    if(error) throw error;
    if(!shipment) return res.status(404).json({success:false,error:'Asset movement not found.',code:'NOT_FOUND'});
    const {data:events,error:eventError}=await supabaseAdmin.from('tracking_events').select('id,event_type,status_from,status_to,facility_name,created_at,public_message').eq('shipment_id',shipment.id).order('created_at');
    if(eventError) throw eventError;
    const location=shipment.privacy_mode ? { label: shipment.consignee_address_generalized, latitude:null, longitude:null } : { label:shipment.consignee_address_generalized,latitude:shipment.current_lat,longitude:shipment.current_lng };
    return res.json({success:true,data:{shipment:{tracking_code:shipment.tracking_code,status:shipment.status,service_type:shipment.service_type,last_verified_at:shipment.last_verified_at,delivered_at:shipment.delivered_at,location,proof_of_delivery:shipment.status==='delivered'?shipment.proof_of_delivery:null},events:events||[]}});
  } catch(error){next(error);}
}
async function list(req,res,next){
  try {
    const page=Math.max(1,Number(req.query.page)||1), limit=Math.min(100,Math.max(1,Number(req.query.limit)||25));
    let query=supabaseAdmin.from('shipments').select('id,tracking_code,status,consignee_name,service_type,facility_id,current_lat,current_lng,last_verified_at,created_at',{count:'exact'});
    if(req.query.status) query=query.eq('status',req.query.status);
    if(req.query.facility) query=query.eq('facility_id',req.query.facility);
    if(req.query.from) query=query.gte('created_at',req.query.from);
    if(req.query.to) query=query.lte('created_at',req.query.to);
    const {data,error,count}=await query.order('created_at',{ascending:false}).range((page-1)*limit,page*limit-1);
    if(error) throw error;
    res.json({success:true,data:{shipments:data||[],pagination:{page,limit,total:count||0,totalPages:Math.ceil((count||0)/limit)}}});
  } catch(error){next(error);}
}
module.exports={getByCode,list};
