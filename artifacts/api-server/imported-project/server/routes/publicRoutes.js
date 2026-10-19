const router=require('express').Router();
const {getByCode}=require('../controllers/shipmentController');
router.get('/:code',getByCode);
module.exports=router;
